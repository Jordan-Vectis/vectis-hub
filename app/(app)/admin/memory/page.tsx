import { isJordan } from "@/lib/jordan-auth"
import MemoryClient, { type Entry } from "./memory-client"

// ─── Static memory content ────────────────────────────────────────────────────
// Updated by Claude alongside memory file changes. Last synced: 2026-07-02
//
// ⚠ This is a SERVER component on purpose. The entries below are filtered here
// and only the permitted ones are serialised to the browser. It must never go
// back to "use client": that would ship every entry — including the gated ones
// — inside the JS bundle, where hiding them in the UI proves nothing.

// Entries only Jordan may see, keyed by filename. /jordan is a private menu that
// 404s for everyone else, so documenting it on a page every admin can open would
// give the whole thing away.
const JORDAN_ONLY = new Set(["jordan_secret_menu.md"])

const ENTRIES: Entry[] = [
  {
    filename: "idle_within_lot.md",
    content: `---
name: Within-lot idle - server-confirmed, and asked at the SAVE not mid-lot
purpose: Why the popup no longer appears part way through a lot, and how a walk-away is still caught. Read before touching any wizard idle check.
metadata:
  type: reference
---

⚠⚠ 2026-08-19 - THE MID-LOT POPUP IS GONE. A WALK-AWAY IS REMEMBERED AND ASKED AT THE SAVE.

Jordan: "I dont want it popping up mid lot either at lot start or lot finish so you get a save at each point and so if a lot takes over half an hour when you finish and save it asks you?" - then, offered the choice, he picked ONLY ASK IF THEY WERE ACTUALLY IDLE: a lot worked on solidly for 45 minutes must never ask; a lot left sitting untouched must.

⚠ A CORRECTION TO THE FIRST DIAGNOSIS, worth keeping. maybePromptIdleBeforeSave ALREADY asked at the save, measuring inactivity. And the mid-lot check skipped taps ON PURPOSE: "a tap can be the Save button, and raising the popup from under a save would swallow it." The obvious-looking fix - run the check on pointer-down too - would have broken saves. DO NOT REINSTATE IT.

THE REAL DEFECT WAS NARROWER: noteInteraction() reset lastInteractionRef without ever recording that a long stretch had happened, so the first tap on returning destroyed the evidence and the save-time check then measured seconds. Measured on a real lot whose own duration was 1h 24m: nobody was prompted, and it surfaced only on the Unaccounted Time report, where the cataloguer had no way to answer it.

WHAT CHANGED (lot-wizard-tab.tsx):
- lotMaxIdleRef - the LONGEST inactive stretch during the lot in progress, and when it began. Cleared in startLotTiming.
- rememberIdleStretch() - folds the stretch that has just ended into that maximum BEFORE the clock is reset. ⚠ Every path that resets lastInteractionRef must call it first, or the stretch is lost for good. It only records stretches already over threshold (and ignores a full working day, the same exclusion the other checks make).
- noteInteraction() calls it first, so ALL THREE capture handlers (pointer-down, change, key-down) now behave identically: end the stretch, remember it, reset. NONE of them can raise the popup.
- maybePromptIdleBeforeSave triggers on max(current stretch, longest recorded stretch).
- checkWithinLotIdle DELETED, with idleConfirmRef. visibilitychange now calls noteInteraction() - returning to the foreground ends the stretch, it does not raise anything.

⚠ THE SERVER CONFIRM IS NOT LOST. maybePromptIdleBeforeSave still calls confirmIdleWithServer, so the 2026-08-07 fix survives: the local measure is only a cheap pre-filter for WHEN to ask, and the SERVER decides whether the person was genuinely away (working-hours gap since their last save on ANY device). A cataloguer active in another tab, on another device or in the native camera is still never accused of being away - that fix exists because a false "2h+ away" popup appeared on a second screen while the cataloguer was saving lots every few minutes on her main one.

⚠ WHY NO "WORKING ON THIS LOT" REASON WAS ADDED: it was offered and Jordan chose the idle-only trigger instead. This matters - EVERY reason in the list writes an IdleLog row the reports count as non-cataloguing time, so prompting on a lot's CLOCK TIME would have forced a cataloguer who genuinely spent 45 minutes on a hard lot to mislabel real work as idle, and it would have landed on them in the activity report. Triggering on INACTIVITY means that lot is never asked about at all. DO NOT "simplify" this to prompt on lot duration.

Prompts now happen at exactly two moments: LOT START (checkIdleOnLotStart, the gap since the last save) and SAVE (maybePromptIdleBeforeSave, inactivity during the lot).`,
  },
  {
    filename: "ai_instruction_house_style.md",
    content: `---
name: AI instruction house style - the one shape all three follow
purpose: The shared shape every Vectis description instruction now uses, and the per-category decisions for Dolls & Bears, Modern Diecast & Tinplate and TV & Film. Read before writing or revising any instruction.
metadata:
  type: reference
---

Three instructions were written to ONE shape over a single session with Jordan (2026-08-19). Follow it for any new category rather than inventing a fourth layout.

⚠ THEY LIVE IN THE DB, NOT IN CODE. All three were delivered as text in chat for Jordan to paste into Auction AI -> Instructions. lib/auction-ai-presets.ts is STARTER DEFAULTS ONLY. Never "add" an instruction by editing that file.
⚠ NAMING: "Vectis Strict: X" = one continuous paragraph. "Vectis Free: X" = an opening summary then a breakdown of the lot. Both new ones are Free - Jordan: "I more want a Vectis Free kind of instructions".

THE SHARED SHAPE:
1. LAYOUT - one item gets a short paragraph, no bullet; two or more get an opening sentence, "The lot comprises:", then one bullet per item in key-point order with a blank line between. Over ~15 items, group the repeats. Estimate on its own line last.
2. THE MAKER IS THE FIRST WORD, with the forbidden openers listed explicitly ("A", "A group", "A collection", "A pair", "A lot", "Lot") and an instruction to rewrite if the sentence starts with one.
3. THE COUNT COVERS THE WHOLE LOT - "a trio of teddy bears and a golly" reads as four items when there are three. Words, never "x three".
4. BULLET ORDER, EVERY TIME: Maker -> item name -> catalogue/product number (omitted ENTIRELY when the key points give none - never invented, completed or corrected) -> description with POSITIVES FIRST -> NEGATIVES LAST, bracketed -> SIZE/SCALE at the very end.
5. The EDITION never opens a bullet - lead with what the item IS, weave the edition in after.
6. The NEGATIVE may not restate the positive - "(fraying to ends)" once the ribbon is described.
7. ONLY WHAT YOU KNOW block - everything from the key points or plainly visible in the photos; a short entry beats a guessed one; never invent a code, edition, year, designer or maker; packaging only from the key points; don't claim a mechanism works.
8. NO CONDITION, EVER. A completeness note from the key points ("swing label bent", "aerial absent") is a fact, not a grade - keep it, at the end.
9. FLAG IS ONLY FOR A SUSPECTED KEY-POINT MISTAKE - never for the AI to comment on its own wording. It had been doing exactly that, which in a real run writes an aiFlagNote and puts an amber Review-tab banner in front of a cataloguer over a fault that is not theirs.
10. The full estimate ladder, £0-£49 through £10,000+.

⚠⚠ THE LESSON THAT COST A ROUND TRIP: A RULE STATED ONCE, IN A DIFFERENT SECTION FROM THE EXAMPLES, DOES NOT SURVIVE. The Dolls & Bears LAYOUT said "Start with the maker", the OPENING section never repeated it, and no example demonstrated it - so the model quietly dropped it and opened "A trio of Merrythought teddy bears...". Every rule that matters must be repeated IN THE SECTION WHERE IT APPLIES and SHOWN IN AN EXAMPLE.
⚠ Keep them LEAN - the prompt goes in on every lot, so verbosity costs money AND makes the model follow fewer rules.

MODERN DIECAST & TINPLATE ("Vectis Free: Modern Diecast & Tinplate"): ONE combined instruction, not two (Jordan's call), deciding which it is then applying the matching section at the bottom. Single items get a paragraph, groups get bullets. ⚠ PACKAGING ONLY FROM THE KEY POINTS - the OPPOSITE of the existing Model Railway presets, which both say "Include packaging" and whose Free one ends with a whole-lot packaging summary line; diecast lots will therefore read differently from railway lots on that point, flagged at the time and left as chosen. Livery and any operator/advertising name is named whenever legible - it is what buyers search. Scale only when the key points give it, never worked out from the model. Tinplate: say how it is driven (clockwork/friction/battery) and whether the key is present when recorded; MANY TINPLATE TOYS CARRY NO CATALOGUE NUMBER AND THAT IS NORMAL - leave it out rather than hunting. An existing "Vectis Strict: Modern Diecast (general)" is in the starter defaults; Jordan never said whether the new one replaces it.

TV & FILM ("Vectis Free: TV & Film"): MANUFACTURER FIRST, same as the others - Jordan chose this over the franchise-first option that was recommended. The fallback matters here: many TV & Film lots have no manufacturer at all (autograph, poster, prop), and those LEAD WITH THE FRANCHISE OR PRODUCTION TITLE instead.
⚠⚠ AUTHENTICITY BLOCK - THE RULE THAT MATTERS MOST IN THIS CATEGORY. Never describe anything as screen-used, screen-matched, production-made, original, genuine, authentic, hand-signed or accompanied by a certificate unless the key points say so IN THOSE TERMS. If the key points call it a replica/reproduction/fan-made, say so plainly and never soften it. On an autograph, don't name the signatory or call a signature genuine unless recorded. This is a MISDESCRIPTION RISK, not a style preference - added on Claude's own judgement and accepted. An existing "Vectis Strict: TV & Film Collectibles" is in the starter defaults (format-only, no domain rules); Jordan never said whether the new one replaces it.

TO ITERATE ON ANY OF THESE: use the 🧪 Instructions Testing tab - 5-10 hand-picked lots, preview only, nothing written. Edit the wording on the Instructions tab first (it is the only editor), then run.`,
  },
  {
    filename: "instructions_testing.md",
    content: `---
name: Instructions Testing tab - the pipeline on 5-10 lots
purpose: Auction AI's test harness for instruction changes. PREVIEW ONLY - it never writes. Read before touching it or adding any apply/save to it.
metadata:
  type: reference
---

Auction AI -> Run group -> 🧪 Instructions Testing (built 2026-08-19). Jordan: "I basically want the auto pipeline but it lets me pick like 5 or 10 lots to run through and test" - the loop for trying an instruction change before letting it near a 500-lot sale.

Lives in its OWN file, app/(app)/tools/auction-ai/instructions-test-tab.tsx, not inside the 6,389-line page.tsx - matching the existing siblings bc-import-check-tab.tsx and macro-tab.tsx. Wired into page.tsx in four places: the import, the Tab union, TAB_GROUPS (Run group, after Auto Pipeline), and the main render.

⚠⚠ IT NEVER WRITES - THAT IS THE ENTIRE POINT. Preview only, chosen by Jordan. Every write the real pipeline performs is deliberately absent: applyAiDescriptionOne, applyAiEstimateOne, saveAiFlagNote, /api/auction-ai/pipeline/lot, /api/auction-ai/runs. No description, no estimate, no aiFlagNote, no PipelineLot row, no saved run. The same awkward lots can be re-run as often as you like with the catalogue untouched. Do NOT add an apply button - that is a decision to take with Jordan first, and the value of the tab is that running it has no consequence. It never touches appliedDesc, so it cannot cause the Review-and-Apply faults.

WHAT IT DOES. Pick a sale, Load lots (only-with-photos on by default), tick the ones you want (First 5 / First 10 / Clear; over 20 shows a cost warning), pick the saved instruction, tick which stages to run. Then per lot: Batch -> Key Points -> Double Check, the pipeline's own order, each stage feeding the next in memory. Each lot expands to show the cataloguer's key points, what is currently on the catalogue, the three stage outputs side by side, KP missing/added, DC contradictions/unsupported, any AI flag, and the final text with a Copy button.

It calls the SAME three server routes (/api/auction-ai/batch, /key-points-check, /double-check), so the instruction text, cleanBearsDescription, auditCodes and the relaxed/strict KP wording all still resolve server-side from the one source. Nothing about the prompts is re-implemented client-side.

⚠ TWO DELIBERATE DIFFERENCES FROM THE AUTO PIPELINE:
1. No instruction editor. RULES.md - "The Instructions page is the only editor. Do not add editing UIs to the run tabs" - and run tabs post a presetKey, never instruction text. Raised with Jordan as a conflict before building; he chose to keep the rule. Edit on the Instructions tab, then come back and run.
2. Retries are BOUNDED (3 attempts, alternating primary/fallback), not infinite. The real pipeline retries forever so a sale never silently loses a lot; a tab you are sat in front of waiting on 5 lots must not hang for half an hour on a rate limit. Nothing fails silently - the give-up reason goes in the log and onto the lot.

Not added to the AUCTION_AI section list in lib/apps.ts, matching Auto Pipeline / AI Upgrade / Double Check which are also absent - so it gates exactly like the tab it tests.`,
  },
  {
    filename: "training_tool.md",
    content: `---
name: Training - a course per panel, tasks marked from live data
purpose: How IT & Admin -> Training is put together, and the one decision that stops it going stale. Read before adding a course or a task type.
metadata:
  type: reference
---

IT & Admin -> Training (/tools/training), added 2026-08-19. A course per panel of the Hub. Jordan asked for it pointed at the Admin Centre first, with "some kind of interactive thing with examples on how to use the admin centre such as find this receipt", and a shell that can take every other panel afterwards.

THE CARD IS allUsers AND HAS NO appKey, DELIBERATELY. Training somebody on a tool is how they end up being given it - gating the training behind the tool's own permission is backwards. WRITING a course is admin-only, checked server-side in lib/actions/training.ts, not just hidden in the UI.

⚠⚠ A PRACTICE TASK STORES NO ANSWER. This is the whole design. lib/training-check.ts pickSubject() chooses a lot or sale that exists RIGHT NOW when the task is handed out, fills it into the brief where the author wrote {{q}}, and markAnswer() works the answer out from the same tables the Admin Centre reads. So a task cannot ask about a lot somebody has since deleted - the failure that rotted the induction PowerPoint, applied to exercises. FREE_TEXT exists and is labelled as the one that WILL go stale; prefer the live kinds (WHO_CATALOGUED, LOT_SALE, LOT_COUNT, LOT_VENDOR, SALE_TOP) plus CHOICE for judgement questions.

Marking is deliberately forgiving in four places, because marking a right answer wrong teaches people the tool is broken: names match on SURNAME (nameMatches), a barcode that appears in more than one sale accepts ANY of its cataloguers, a genuine tie on "who did the most" accepts either name, and dates (dateMatches) accept the day with the month named or numbered and do NOT require the year - the trainee is copying one date off a screen.

⚠ THE ADMIN CENTRE COURSE LIVES IN lib/training-admin-centre.ts, not in training-seed.ts (which re-exports it). 13 slides and 8 scenarios - deliberately SHORT. Jack, 2026-08-19: "its a super simple tool", after a 38-slide version was too long. If you are tempted to add a slide, put it in a presenter note instead.

⚠⚠ THE ADMIN CENTRE IS ONE PAGE WITH FIVE BUTTONS, NOT THREE TABS. Jordan rebuilt it 2026-08-18 (lookup-client.tsx: "combine all the options on this page to be a single page... as simple and idiot proof as possible"). Modes are receipt / tote / vendor / sale / code, and the three tab components survive only as RENDERERS driven by a controlled prop - their own search cards are dead code on that route. Two deck versions were written against the old three-tab UI and were wrong. So: the training practice pane embeds LookupClient (the whole page), never the sub-tabs, and TrainingExercise.panel is now a HINT of which of the five buttons to press, not a choice of component.

WHAT THE PANEL DOES NOT DO, verified 2026-08-19 by reading every select: it NEVER shows CatalogueLot.description. All three renderers show title (83 chars) and none of the three routes even selects description or keyPoints. The screen calls that column "Item" and prints "No description yet" for a blank title, so people reasonably assume otherwise. Final descriptions live in Description Finder (/tools/description-finder), which does select the full text. A slide promising descriptions here would be wrong - there is one saying the opposite.

⚠ CONDITION REPORTS SHOWS THE WRONG CATALOGUER. app/(app)/tools/condition-reports/page.tsx calls lookupLotCataloguer (lib/condition-bc.ts), which reads BC's WarehouseItem.cataloguedBy - the push stamp. So that screen names whoever ran the import, usually Jack or Jordan, while the Admin Centre names the real cataloguer from CatalogueLot.createdByName. Two screens, two answers, same lot. The deck warns about it in a presenter note; the screen itself has not been changed.

⚠ DO NOT SAY "MOST OF BC IS WRONG" ON A SLIDE. The measurements do not support it and an earlier slide claiming BC's cataloguer is "blank more often than not" was wrong - 165,764 of 216,244 rows carry a cataloguedBy (blank on ~23%), toteNo is 89% filled, and the barcode prefix agrees with BC's auction code on 94.6% of 211,229 rows. What IS unreliable is narrow and specific: the three ATTRIBUTION fields - catalogued by, catalogued date, category - because they record the bulk push rather than the work. Coverage is good; attribution is not.

Marking helpers live in lib/training.ts: names match on SURNAME, dates accept the day with the month named or numbered and do NOT require the year, and a barcode found in more than one sale accepts ANY of its cataloguers.

RESTORING AN IMPROVED COURSE. The seed only writes into an EMPTY table, which is right - a deploy must never silently undo somebody's edits - but it means an environment seeded months ago can never pick up a lesson improved since. restoreBuiltInCourse(moduleKey) on the Edit tab is the deliberate, admin-only, double-confirmed way to replace a course's slides and tasks with the shipped version. It DELETES what is there; progress rows are left alone. Only LOT_LOOKUP has a built-in course to restore.

PICKING IS BOUNDED. LOT_COUNT / LOT_VENDOR group the most recent 1000 lots in JS rather than a GROUP BY over the whole table - this runs on every practice page load and there are hundreds of thousands of lots. A receipt seen twice inside that window certainly has two overall; the ANSWER is still counted against the full table at marking time.

THE SLIDES REUSE THE INDUCTION RENDERER. components/training-slide.tsx is a thin adapter over components/induction-slide.tsx (liveBlock forced to NONE, empty LiveData) plus a "Try it" button rendered AROUND it. A training slide and an induction slide are the same object; a second copy of that 350-line renderer would drift the first time either was fixed. Layouts, the two-column bullet flow, the numbered-steps graphic and the body-text convention (blank line = paragraph, "- " = bullet, short line with no full stop = heading) all come free. The presenter is its own copy because its keys and exit route differ.

THE PRACTICE PANE EMBEDS THE REAL PANEL, not a screenshot - app/(app)/tools/training/panel-embeds.tsx dynamic-imports the actual FindLotsTab / WhoCataloguedTab / BySaleTab. Consequence: it needs the panel's OWN permission, so the module page passes canOpenPanel and the pane says so plainly rather than rendering a dead box. To add practice for another panel, export its tab components and add one entry to PANEL_EMBEDS.

MODULE_SEEDS is derived from APP_CARD_DEFS, not typed out - a tool added to the Hub gets a training slot automatically and nothing here can name a panel that no longer exists. Seeding follows the induction pattern exactly: per-key checks under a pg_advisory_xact_lock, only ever into empty tables, so editing lib/training-seed.ts changes nothing on an environment that has already been seeded.

Tables TrainingModule / TrainingSlide / TrainingExercise / TrainingProgress (NEEDS Run Migrations). Every read in lib/training-data.ts is try/caught - the code reaches Railway before the button is pressed, and an empty course list beats a 500 on the Hub.`,
  },
  {
    filename: "sandbox_environment.md",
    content: `---
name: Sandbox - staging's code, production's data
purpose: The third environment and the one setting that keeps it safe. Read before touching env vars or the server.js cron loops.
metadata:
  type: reference
---

https://vectis-hub-sandbox.up.railway.app - created 2026-08-18. Jordan: "what I need is another staging environment that has mains data so I can test these things properly". Staging's own data had drifted far enough from production that screens looked fine there and wrong on live - the Admin Centre's holding-pen sales were only visible on real data.

- Neon branch "Sandbox", parent production, "Branch data and schema", auto-delete Never. Copy-on-write, so it costs almost nothing and cannot affect production. REFRESH IT by deleting the branch and re-branching from production - seconds.
- Railway environment duplicated from staging, deploying the STAGING branch (so one push updates both), with DATABASE_URL pointed at the Neon branch and its own NEXTAUTH_URL.
- Added to the Environments dropdown (components/env-selector.tsx - a hardcoded list, not derived from anything).

⚠⚠ THE BACKGROUND JOBS ARE OFF ONLY BECAUSE CRON_SECRET IS UNSET. server.js starts five loops on boot and EACH ONE RETURNS IMMEDIATELY when CRON_SECRET is missing. That single absence is the entire safety mechanism. With production data in front of it and a secret present, the sandbox would: poll the REAL IT and condition-report mailboxes and turn live customer emails into Job Board jobs / Condition Reports alongside production doing the same; write DATABASE BACKUPS INTO THE REAL R2 BUCKET; and run the BC warehouse sync and the overnight pipeline queue. NEVER set CRON_SECRET on the sandbox, and never "fix" a cron that looks broken there by adding one.

⚠ IT SHARES THE R2 BUCKET. Photos READ fine, which is the point - real lots with real pictures. But a delete in the sandbox deletes the ACTUAL FILE, because it is the same bucket. Don't delete photos there, or split the bucket first.

⚠⚠ BC IS ALREADY CONNECTED THERE, AND TO REAL BC. BCToken is a DATABASE table (one row per user), not a Railway variable, so Jordan's real token came across with the branched data - he did NOT have to reconnect, and my telling him he would was wrong. The Hub only READS from BC and Push to BC is a sheet pasted in by hand, so nothing writes automatically, but the sandbox is NOT sealed off from BC the way it is from the mailboxes.

⚠ STAGING'S NEON BRANCH IS ALSO A CHILD OF PRODUCTION, so staging is not empty - it is production's data frozen at whenever that branch was created. That is exactly why it stopped being a useful test bed.

The Neon branch inherits production's schema, which can be behind the code - the app's own pending-migrations banner covers that.`,
  },
  {
    filename: "measurement_flags.md",
    content: `---
name: Measurement flags - we measure the item
purpose: Why a size differing from the manufacturer is never a cataloguer mistake, and the two traps in telling a size complaint from a code complaint. Read before touching any flag prompt or lib/measurement-check.ts.
metadata:
  type: reference
---

2026-08-17. Jordan: "I need the cataloguer mistake checker to not do this in the bears auctions it creates loads of flags because the size is different to the manufacturer but we re-measure it in case the bear has been cut or modified. It only needs to flag it if they put like 10 inches is 100cm or something like that."

THE PRINCIPLE. A size in the key points is the cataloguer's OWN measurement of that item, taken with it in hand. Bears especially are re-measured BECAUSE one may have been cut down, re-stuffed or restored. A size differing from the manufacturer's published spec is therefore EXPECTED, and flagging it buries the real mistakes. The only measurement error worth anyone's time is one that CONTRADICTS ITSELF.

Two halves, on purpose:
1. MEASUREMENT_FLAG_RULE in lib/flag-rules.ts - one shared block wired into all FOUR flag prompts (Batch route, Re-check Cataloguer Flags route, lib/key-points-instruction.ts in BOTH modes, lib/double-check-instruction.ts). ⚠ Flag guidance is spread across those four and drifts; add shared flag rules to flag-rules.ts, not to one prompt.
2. lib/measurement-check.ts - the arithmetic, in code rather than trusted to a model (they are unreliable at exactly this sum). shouldKeepFlag(note, keyPoints) gates EVERY write: the three sites in lib/pipeline-runner.ts and saveAiFlagNote (the path the browser Auto Pipeline tab and Re-check Flags write through).

⚠ THE TWO TRAPS, BOTH FOUND BY MEASURING AGAINST THE 104 LIVE FLAGS:
- A CLOSING QUOTATION MARK AFTER DIGITS IS NOT AN INCHES MARK. Flags quote what they dispute - 'it should be "2150"' - and 2150" matched an inches pattern, so TWO GENUINE PRODUCT-CODE TYPOS (215O->2150, R40127->R40217) were being dropped as "measurements". The unit must now be SPELLED OUT (cm/mm/in/inch), or be part of a real inch-to-cm pair.
- A CODE COMPLAINT NAMES TWO CODES; A SIZE COMPLAINT NAMES ONE. "CBCB232301B is a typo for CB232301B" mentions a size too, and dropping it would bin a real catch. So two or more distinct product codes in the note KEEPS it (codeSet from lib/product-codes.ts).

After both fixes: 1 of 104 existing flags drops, and it is a true size-vs-spec one. Jordan's screenshot flag (F109400, 16"/41cm vs a claimed 15.5"/39cm) drops; 10 inches / 100cm survives.

⚠ TOLERANCE IS DELIBERATELY GENEROUS - max(2cm, 20%). Cataloguers round to the nearest centimetre and sometimes to five; the errors that actually happen (a unit slip, transposed digits) are factors out, not percentages. Tightening it re-creates the flood this exists to stop.

⚠ THE RULE IS GLOBAL, NOT BEARS-ONLY. Re-measuring is how the whole saleroom works; the same false flag would appear on a diecast model's length. Bears were simply where the volume showed.

⚠ The gate applies ON WRITE, so flags already on lots stay until that lot is re-run. Clearing the existing ones would need a UI action - not built.`,
  },
  {
    filename: "idle_gap_ends_at_lot_start.md",
    content: `---
name: The idle gap ends at LOT START, not at the save
purpose: Why evaluateIdleGate takes a measureTo, and why the lot-start marker must be stamped by the server. Read before touching the idle gate or the last-activity endpoint.
metadata:
  type: reference
---

2026-08-17. Jordan: "It should be when it started as the problem is lets say someone goes for their lunch comes back makes a lot then the idle timer triggers after making the first lot even though they might of spent 10 mins doing the lot".

THE BUG. evaluateIdleGate measured lastSave -> Date.now(). createLot calls it AT SAVE TIME, so every lot's own working minutes were counted as part of the preceding break. Measured against the real maths: a 20-minute break followed by a 35-minute lot reported a 55-MINUTE gap and prompted on a 30-minute threshold - a false accusation. Jordan's lunch example reported 70 minutes for a 60-minute break.

THE FIX. evaluateIdleGate(userId, measureTo):
- "now" (default) - right for the popup at LOT START, because "now" IS the start.
- "lot-start" - used by the createLot gate; the gap ends at the server-stamped marker.

⚠⚠ CataloguerLotStart IS STAMPED BY THE SERVER (one row per user, overwritten), via GET /api/catalogue/last-activity?event=lot-start. NEVER take the start from the device, and never derive it as now minus a client-reported durationMs: a tampered device could claim a three-hour lot and erase a real three-hour gap - the same class of bypass the server-authoritative gate was built to close.

⚠ ONLY checkIdleOnLotStart MAY PASS ?event=lot-start - it fires on the first keystroke of a new barcode. The other caller, confirmIdleWithServer (used mid-lot and at save), must NOT: the marker would creep forward all through the lot and erase the very gap it exists to measure.

Deliberate details, all of which matter:
- A marker OLDER than the last save, or in the future, is IGNORED - a save has happened since, so it cannot describe the lot being saved now. Falls back to "now", which is exactly the old behaviour, so a deploy before the migration is no worse than before.
- ⚠ A MARKER CAN BE STALE-EARLY: a lot started, abandoned without saving, a long absence, and the next lot's start not re-stamping (checkIdleOnLotStart bails when a popup is already open). Measuring to that old start would HIDE the absence. The client's reported durationMs corrects it, used ONLY as a LATER bound and ONLY when a marker exists: endMs = max(marker, now - durationMs). A device can therefore only ever push the end LATER, which makes the gap BIGGER - claim a three-hour lot and it picks the marker and ignores you; claim a zero-length lot and the gap grows. With no marker there is no client input at all. Six cases regression-checked, including both attacks.
- The CLEARED_BY_REASON window still runs to nowMs, not the measured end - a reason logged DURING the lot (the within-lot check) must still account for the break.
- IdleGateEval gained measuredToMs; nowMs stays the true server clock because clockLooksTampered compares the device's claim against it.

⚠ THE WITHIN-LOT MEASURE STAYS AT "NOW". It asks "have you wandered off during this lot?", and measuring it to lot start would give ~0 and reopen the hole the 2026-07-20 second check closed. ⚠ UPDATED 2026-08-19: checkWithinLotIdle no longer exists - the mid-lot popup was removed and the walk-away is now remembered and raised at the SAVE by maybePromptIdleBeforeSave, which still measures to now.

⚠ THE REPORTS WERE ALREADY CORRECT - lib/cataloguing-reports.ts treats a lot as occupying [savedAt - durationMs, savedAt]. Only the live gate was wrong. And CatalogueTimingLog.savedAt is the FINISH time (@default(now()), never passed in by the client); a lot's start is savedAt minus durationMs.`,
  },
  {
    filename: "auction_favourites.md",
    content: `---
name: Auction Manager - Currently working on (favourites)
purpose: Per-user starred sales pinned to the top of Auction Manager. Read before touching the auctions list or adding another "status" to a sale.
metadata:
  type: reference
---

Built 2026-08-17. Jordan: "can I have a quick way to favourite auctions so I can separate ones at the top of the page that im currently working on". /tools/cataloguing/auctions.

A star in a new FIRST column on every row. Starred sales are lifted out of their normal section into a "★ Currently working on" block pinned above Active Auctions, with an amber border.

⚠⚠ PER USER - AND NOT A STATUS. CatalogueAuctionFavourite (NEEDS Run Migrations): compound primary key (userId, auctionId) plus createdAt, both foreign keys cascading - the same join-table shape as UserDepartment. Nothing about a starred sale is visible to anyone else, and the header says "only you see these" so nobody mistakes it for a shared flag.

⚠ It is NOT a sale status. catalogued / photography / addedToBC / aiRan / complete are columns on CatalogueAuction describing the SALE; a favourite describes one person's attention. Never add it to STATUS_FILTERS, the overview PDF, or anything that reports on a sale.

- toggleAuctionFavourite(auctionId) in lib/actions/catalogue.ts RETURNS { ok, favourite, error? } rather than throwing (production redacts thrown server-action messages). Deliberately NOT BC-locked: it changes nothing about the sale.
- The page reads the user's favourites inside a try/catch - the table only exists once the migrations have been run, and an empty set has to mean "nothing starred", never an error page.
- The star flips in LOCAL STATE FIRST and reverts if the write fails. Waiting on a round-trip before anything moves reads as a dead button on the shared iPads. The button is a 44px touch target (design rule 5).
- A COMPLETED sale can be starred too and pins the same way - a sale you are still fixing up is exactly the case. Both the Active and Completed tables have the pinned rows removed so nothing appears twice, and each section explains itself when everything in it is starred rather than looking empty.`,
  },
  {
    filename: "patches_and_changes.md",
    content: `---
name: Admin -> Patches & Changes
purpose: The development record and the AI progress report for managers. Read before touching the build-time capture, the seed, or the ingest.
last_updated: 2026-08-14
---

# Admin -> Patches & Changes (built 2026-08-14)

Jordan asked for "a progress report of everything we have worked on for the last 2 weeks", then chose to make it permanent: "start a new section in the admin section called patches and changes that from now on will pull in all the changes we have made so I can then use AI to summarise it in a report for my managers".

/admin/changes, admin only. Left: what has gone into the Hub, grouped by day, over 7 days / 2 weeks / 30 days / 3 months / 1 year. Right: "Write the report" produces an AI summary aimed at a manager, which can be edited, saved and copied.

## WHERE THE DATA COMES FROM - AND WHY IT IS ODD

The running app has NO git and NO GitHub token. That is deliberate - see the scope note in app/api/patch-notes/draft/route.ts. Railway only hands the app RAILWAY_GIT_COMMIT_MESSAGE, the head commit of the current deploy, so a deploy containing five commits would record one. Offered the choice, Jordan picked the build-time capture over adding a GitHub token.

Three sources, all in lib/changelog.ts, all keyed on SHA so re-ingesting is a no-op:
1. changelog-capture.json - written by scripts/capture-changelog.mjs during npm run build, the one moment Railway still has a clone. Gitignored, read at runtime with fs, never imported.
2. lib/changelog-seed.ts - the history from 1 July 2026, COMMITTED ON PURPOSE so a shallow clone cannot leave the page empty.
3. RAILWAY_GIT_COMMIT_* - so a deploy always records itself even if both of the above fail.

ingestChanges() runs on every page load and is idempotent.

## ⚠⚠ MEASURED 2026-08-17: RAILWAY'S BUILD HAS NO .git AT ALL

Jordan: "We have made so many changes today but the patches tab only has 1 thing". A full day - 22 commits - showed as ONE line, and the author rendered as the GitHub handle "Jordan-Vectis" instead of "Jordan Orange". That handle is the tell: it is RAILWAY_GIT_AUTHOR, so fromGit() returned NOTHING and fromEnv() supplied the row. It is not a shallow clone - there is NO GIT IN THE BUILD AT ALL, which means source 1's whole premise ("the one moment Railway still has a clone") is WRONG. Do not try to fix this with git fetch --unshallow: there is no repository there to deepen.

THEREFORE lib/changelog-seed.ts IS THE ONLY ROUTE by which the app can ever see a change that is not a deploy's headline commit. It had gone stale by 33 commits.

- npm run changelog:seed (scripts/refresh-changelog-seed.mjs) regenerates it from the full LOCAL history. ⚠ RUN IT AND COMMIT THE RESULT AS PART OF EVERY PUSH - now a rule in RULES.md under the branch/deploy rules. Ingest is keyed on sha, so re-seeding only ever adds what is missing.
- Two guards, both deliberate: it REFUSES to write from a shallow clone, and REFUSES to shrink the file. Writing a 1-commit seed would delete the committed history and leave the page emptier than before - far worse than not refreshing at all.
- The "record is complete up to X" banner now reads its date from SEED_COMPLETE_TO (the seed's newest entry) and only appears when the changes on screen actually fall PAST that date. It previously keyed off the capture source alone with a HARDCODED "13 August", so it was permanently on and permanently wrong - a real signal turned into wallpaper. ⚠ Never hardcode that date again.
- The permanent alternative - a read-only GitHub token so the app tops itself up - remains REJECTED (2026-07-17). Refreshing the seed is the agreed price of the app having no credentials.

## THINGS NOT TO UNDO

- THE CAPTURE SCRIPT MUST NEVER FAIL THE BUILD. Everything is inside one catch and it exits 0 regardless. Verified by running it with git off the PATH: it writes source "none", exits 0, and the committed seed covers the gap. A missing changelog is an annoyance; a deploy that will not build is not.
- lib/changelog.ts uses fs, so it is SERVER ONLY - never import it from a "use client" file. Checked after the build: the seed does not appear in the browser bundle.
- DISTINCT FROM PatchNote (/admin/announcements), which is the staff-facing one-time popup drafted from a single deploy. Same subject, completely different audience - do not merge them.
- ⚠ IT IS A LOG, NOT A HIGHLIGHTS REEL (Jordan, 2026-08-14: "We dont need the intro summary just a log of all the changes to each section is fine. It can maybe be a bit more detailed than it is now"). The prompt has NO opening summary and NO closing paragraph - it starts straight in on the first area heading - and it must account for EVERY change that is not marked [internal], a sentence or two each, with the most-changed area first. A long list is the expected output. Do not reinstate "reads in two minutes" or any other compression instruction. maxOutputTokens is 32768 for the same reason.
- PDF: lib/changes-pdf.ts via POST /api/admin/changes/pdf. A4 portrait with the Vectis header. The client POSTS the report it is SHOWING rather than an id, so the same button prints an unsaved draft complete with your edits, and a saved report exactly as saved - the same approach as the BC Warehouse table PDFs. ALL-CAPS lines print as area headings and lines starting "- " as bullets, so the plain text the AI wrote comes out structured on the page.
- NO AUTHOR NAMES EVER REACH THE AI (Jordan, 2026-08-14: "I dont need the name of who did what on the actual manager report"). changesToText omits them entirely rather than the prompt merely discouraging them - a name the model never sees cannot end up in the report. The on-screen list still shows who did what; it is only the report that is anonymous.
- The AI slot is changes_summary (claudeOk). Its prompt forbids technical wording, groups the work by what it was FOR rather than by date or person, and bans invented benefits, figures or time savings. Lines marked [internal] (memory, rules, docs, chore, merge, revert - see isHousekeeping) are hidden by default and the prompt is told not to give them their own section.
`,
  },
  {
    filename: "pipeline_overnight_queue.md",
    content: `---
name: Auto Pipeline - overnight queue (server-side)
purpose: The queue that runs several sales back to back with different settings and nothing left open. Read before touching lib/pipeline-runner.ts, the server.js cron loop, or the cron-auth guards on the AI routes.
last_updated: 2026-08-13
---

# Auto Pipeline - overnight queue (built 2026-08-13)

Jordan's ask: "can I have the ability to que different auctions with different setting so for example if I want to run a bears auction through and when it finished it starts the trains one overnight". Asked where it should run, he chose the SERVER-SIDE option over a browser-tab queue, knowing it was the bigger build.

WARNING: the Auto Pipeline tab's own Run button STILL RUNS IN THE BROWSER - its loops, its 12-second gaps, its backoff. It only continues while that tab is open and the PC is awake. The queue is the way to run unattended. Do not conflate the two when diagnosing "it stopped overnight".

## Shape

- PipelineQueueItem - one row per queued sale, carrying its OWN settings (preset, model, fallback, grounded, autoApply, onlyWithPhotos, skipHasDesc, kpRelaxed) plus progress, retryAfter, heartbeatAt and a logText morning report. NEEDS Run Migrations. Per-lot progress still lives in PipelineRun / PipelineLot keyed by auction code - that is what makes a slice resumable.
- lib/pipeline-runner.ts is the worker. server.js ticks /api/cron/pipeline-queue every 30 seconds; each tick does a roughly nine-minute SLICE and hands back, and the next tick carries on from the same lot.
- UI (MOVED 2026-08-14): its own page at **/tools/auction-ai/overnight** (overnight-client.tsx), with a per-run page at **/tools/auction-ai/overnight/[code]** (run-client.tsx). Server actions in lib/actions/pipeline-queue.ts, list at GET /api/auction-ai/queue, per-lot detail from GET /api/auction-ai/pipeline?code=.

## The queue also runs AI UPGRADE jobs (2026-08-20)

Jordan asked for the AI Upgrades overnight as well, and chose the SAME overnight page (a run KIND on the queue form: Auto Pipeline / AI Upgrade) and save-for-morning-review over auto-apply.

- PipelineQueueItem.kind ("pipeline" | "upgrade") + upgradeModes (comma-separated keys) + a new UpgradeLot table (queueId+lotId unique; original/revised/status/accepted). NEEDS Run Migrations. UpgradeLot rows ARE the resume record (a lot with a row is never re-run) and the review data.
- WARNING: an overnight upgrade run writes NOTHING to the catalogue. Every rewrite is held in UpgradeLot; the morning page /tools/auction-ai/overnight/upgrade/[id] (keyed by queue-item ID, because the same sale can also have a pipeline run queued — run-client.tsx filters kind !== "upgrade" when finding its item by code) shows before/after with Accept / Accept All. Accept = acceptUpgradeLot action → applyAiDescriptionOne (the same logged path the tab uses) → row marked accepted. Accept REFUSES when the lot's description has changed since the rewrite (compared against UpgradeLot.original) — the appliedDesc overwrite-newer-edits trap, blocked by design. Accept All loops client-side so one refusal doesn't stop the rest.
- The runner branch runUpgradeKind uses the same withRetry / slices / heartbeat / 12s-gap machinery and calls THE SAME /api/auction-ai/upgrade route the tab uses (isCronRequest added alongside the session check) — never re-implement the mode instructions in the runner. A content block becomes row status "blocked", an empty result "empty"; both appear on the review page's "Refused / empty" filter.
- lib/upgrade-modes.ts is now the single source of the UPGRADE_MODES list (page.tsx imports it; the instruction TEXT stays in the upgrade route's MODE_INSTRUCTIONS). addToPipelineQueue validates modes against it server-side.
- The duplicate-in-queue check is now per code+kind, so a pipeline run and an upgrade run may coexist for one sale — the queue is strictly serial, they can never interleave.
- The queue API returns upgradeDone/upgradeAccepted per item so the list card can say "N rewrites waiting for review"; progress on upgrade cards is labelled lots (one stage), not steps.

## The queue is GONE from the Auto Pipeline tab (2026-08-14)

Jordan: "I really dont like how this overnight que works... revert the Auto Pipeline to not have the overnight que stuff then make a new page called Overnight AI runs or something similar... I think you should be able to list out all the runs then click inside of them to see what is actually happening."

pipeline-queue-panel.tsx is **deleted** and the Auto Pipeline tab carries a signpost link only. WARNING: do not put a queue back on that tab. Two things were wrong with it living there. The thing you check in the morning was buried at the bottom of the thing you drive by hand — and, the real fault, **a queued sale silently inherited whatever the Auto Pipeline tab happened to be set to at that moment**, so what a sale would run with depended on a screen somewhere else entirely. The new page's queue form **states its own settings**: sale, instruction, model, fallback and every toggle.

Opening a run now shows it lot by lot, because everything needed was already stored per lot on PipelineLot and nothing was reading it: each stage's outcome, what Double Check contradicted or found unsupported, which key points were missing and which were put back, the text produced, and whether it actually reached the catalogue. WARNING: "written to the catalogue" on that page uses the SAME appliedDesc comparison as Review & Apply — do not re-derive it from the live catalogue description (see the appliedDesc entry for why that silently resurrects applied lots).

Jordan chose a route UNDER Auction AI, so it inherits the AUCTION_AI gate from app/(app)/tools/auction-ai/layout.tsx — do not add a second gate. The sidebar entry is a Link, not a tab: the tabs are client state on one 6,000-line route, and a morning check should not have to load it.

WARNING: the MACHINERY is untouched — the runner, the nine-minute slices, the cron loop, the retries, the cron-auth guards. This changed where you drive it from, not how it runs.

## Adding a sale does NOT start it (2026-08-14)

Jordan: "They seem to be auto starting without me saying to?" — and he was right. There was never a start gate anywhere. The runner picks up ANY row with status QUEUED on its next tick, which is every 30 seconds with no time-of-day check, so adding a sale to the queue WAS the instruction to run it. "Overnight" only ever meant "does not need your browser open", never "waits until tonight".

Fixed without touching the runner: addToPipelineQueue creates the row as **PAUSED**, which the runner never picks up, and startPipelineQueueItem / startAllPipelineQueueItems move it to QUEUED. WARNING: never create these as QUEUED again.

WARNING: PAUSED now means two different things — **never started** versus **held mid-run** — and they are told apart by startedAt being null. Always label through **queueStatusLabel(item)** / isNotStarted(item) in lib/pipeline-queue.ts, never off QUEUE_STATUS_LABEL directly, or a brand-new sale reads as "Paused" like something went wrong.

## The overnight pages deliberately MIRROR the Auto Pipeline tab's visual language (2026-08-14)

Jordan: "Can it have some of the symbols and ui features of the autopipeline tab". So the run page carries the same three stage cards — ⚡ Batch Run, ✓ Key Points Check, 🔎 Double Check — with the tab's own states (gold and pulsing while running, green with a tick once past, dimmed until reached) and the same per-stage wording: "N generated OK", "N missing key points added", "N descriptions corrected", "N content blocked by AI". The lot table uses those symbols instead of prose, the run log is colour-coded the way the tab colours its own, a finished run gets the same celebration summary, and the list shows the three stages as pips.

WARNING: keep the two in step. Two visual languages for one pipeline is how someone ends up unsure whether "issues" on one screen means what "issues" means on the other.

WARNING: the signpost block that briefly sat on the Auto Pipeline tab pointing at the new page was ALSO removed ("this doesnt need to be here") — the sidebar link is the only pointer now. Do not re-add either the queue panel or a signpost to that tab.

## WARNING: PipelineQueueItem.total is STAGE PASSES, not lots

A 601-lot sale reads about 1693, because outstanding() counts every stage pass still to do: 601 batch + 491 key-point + 601 double-check. Jordan hit this as "its saying lots done 1693 when there is only 601 lots in that auction?" — the figure was right and the LABEL was wrong. Call it steps, and if a real lot figure is wanted, count the PipelineLot rows that actually have text. Do NOT "fix" the runner's maths: counting stage passes is what keeps the number meaning the same thing across resumed slices.

## The things that will bite

- THE RUNNER CALLS THE SAME ROUTES THE BROWSER DOES (batch, key-points-check, double-check, catalogue-lots, pipeline, pipeline/lot, photo-proxy) over localhost, authorised by isCronRequest in lib/cron-auth.ts (Bearer CRON_SECRET). This is deliberate: those routes hold the tuned prompts, the key-points authority rules, the bears clean-up and the English rule. NEVER re-implement a prompt inside the runner - change it in the route and both paths get it. isCronRequest is only ever used ALONGSIDE the session check, never instead of it, and DELETE /api/auction-ai/pipeline (the reset) is deliberately left session-only.
- NEVER GIVES UP (Jordan's explicit instruction). A lot that errors is left UNMARKED and retried across ticks and across restarts, forever, with the same backoff the browser uses (60s doubling to a 30-minute cap for rate limits, 12s to 30s otherwise). Nothing is ever marked failed. The single exception is the pre-existing rule: a Gemini CONTENT BLOCK skips that lot because it will never succeed on retry, and RECITATION retries four times on the other model first. If a wait will not fit in the remaining slice, SliceOver carries it into retryAfter so the sale sleeps exactly that long and resumes ON THE SAME LOT.
- READING SAVED PROGRESS IS NOT BEST-EFFORT. If GET /api/auction-ai/pipeline fails, loadLots THROWS. Treating that as "nothing done yet" would send every already-finished lot back through the AI and, with auto-apply on, overwrite good descriptions. Do not "harden" it into a silent fallback.
- flush() splits progress from status. Progress and the log are always saved; the STATUS is only moved on a row that is not PAUSED or CANCELLED. Without that split, pressing Hold mid-slice was silently undone when the slice ended, and pressing Remove mid-slice made the error handler throw. stopRequested() is also checked between lots so Hold takes effect within seconds rather than at the end of a nine-minute slice.
- Claiming a sale is conditional (updateMany on the expected status), and a RUNNING row whose heartbeat is older than three minutes is reclaimed - that is how a deploy restarting mid-sale resumes rather than stalling.
- The runner writes lots itself (it has no session, so it cannot use the applyAiDescriptionOne server action) but logs through lib/lot-log.ts exactly the same way, as changedBy "Auto Pipeline (overnight...)" with source "ai_apply". RULES: every path that mutates a lot must log.

## 2026-08-19 — AUDITED AGAINST THE BROWSER TAB: IT DOES FOLLOW THE SAME RULES

Jordan asked whether the overnight runs obey everything the tab does, "for example does it not run anything excluded by ai?". Checked in code rather than assumed.

- aiExcluded — NEVER TOUCHED, AND STRUCTURALLY SO. Both the tab and lib/pipeline-runner.ts load through the SAME /api/auction-ai/catalogue-lots route, whose Prisma query carries where: { aiExcluded: false }. An excluded lot never enters either run, so there is no second copy of the rule that could drift. ⚠ Keep it that way - do NOT give the runner its own lot query.
- Same three server routes, so the instruction text, cleanBearsDescription, auditCodes and the strict/relaxed KP wording are identical by construction.
- shouldKeepFlag gates all three stages, so a size that merely differs from the manufacturer raises nothing overnight either.
- appliedDesc is only recorded when the catalogue write actually succeeded.
- Every per-sale toggle mirrors the tab (PipelineQueueItem): preset, model, fallbackModel, grounded, autoApply, onlyWithPhotos, skipHasDesc, kpRelaxed.
- The AI estimate is saved regardless of auto-apply, same as the tab, because it lives in its own fields.

⚠ THE ONE GAP FOUND, NOW FIXED - OVERNIGHT FLAGS LEFT NO AUDIT TRAIL. All three stages wrote aiFlagNote with a bare prisma.catalogueLot.update, so a flag raised overnight left NO entry in the Lot Change Log while the identical flag raised from the tab did (that path goes saveAiFlagNote → updateLotLogged). Against the rule directly above it. Fixed with a flagCtx(ctx) helper stamping source "ai_flag" - the same source the browser path uses, so the only difference between the two in the log is changedBy. The writes stay try/catch and advisory: a logging failure must never fail a run.

⚠⚠ 2026-08-19 - A LONG RATE-LIMIT WAIT COULD GET THE SAME SALE RUN TWICE. Found while answering "will pushes to main or server outages break the overnight run?" - this one is not about restarts at all. flush() is the ONLY thing that writes heartbeatAt and it runs ONCE PER LOT; addLog appends to an in-memory array and writes nothing. withRetry slept in-process for the whole backoff, taken in-slice whenever deadline.fits(wait). The rate-limit backoff is 60s → 120s → 240s → 480s, so from the THIRD consecutive 429 the row sat untouched for 4+ minutes, passed HEARTBEAT_STALE_MS (3 min), and the 30-second tick reclaimed it as a crashed slice while the original was still asleep and would wake and carry on. TWO SLICES ON ONE SALE - double the Gemini spend and interleaved writes. Reachable on any busy sale.
THE FIX reuses existing machinery rather than adding a heartbeat thread: withRetry now throws SliceOver(wait) when wait >= HEARTBEAT_STALE_MS, not only when it will not fit the slice. SliceOver already carries the wait into retryAfter and the handler parks the row as QUEUED (deliberately not RUNNING, "so a stale heartbeat can't make another tick think it crashed"), so the sale sleeps exactly that long and resumes ON THE SAME LOT. Measured split - max in-process sleep is now 120s against a 180s window: in-process 12s/24s/30s, 1.5s RECITATION, 60s and 120s; steps out to the queue 240s, 480s, 960s onwards. ⚠ On resume attempt resets, so it retries at once then 60s, 120s and steps out again - it still NEVER GIVES UP, which is the standing rule. Total waiting is unchanged, it just moves to the queue where it is visible in lastMessage and cannot be mistaken for a crash.

DO PUSHES OR OUTAGES BREAK AN OVERNIGHT RUN? NO - verified 2026-08-19. The queue row stays RUNNING with heartbeatAt; after a restart the 30-second tick finds a heartbeat older than 3 minutes, takes the sale over, logs "▶ Picked {code} back up (the server restarted or the last slice ran out of time)", reloads progress from PipelineRun/PipelineLot and carries on from the same lot. The lot in flight when the process died was never marked, so it is simply redone; nothing is ever marked failed. loadLots THROWS rather than assuming "nothing done yet", so a restart cannot send finished lots back through the AI. Cost of a deploy is about a 3-minute gap plus boot; main restarts production only, staging restarts staging only. ⚠ WHAT DOES BREAK IS THE BROWSER AUTO PIPELINE TAB - deploy skew, the 512-lot Trains incident. The queue exists so nothing needs a tab open: deploy freely while the queue runs, just do not leave the tab running through one.

DO THE FLAGS STILL REACH THE REVIEW TAB AFTER AN OVERNIGHT RUN? YES. The flag is written to CatalogueLot.aiFlagNote, which is exactly what the Review tab's amber banner and its "AI-flagged only" filter read - the missing piece was only the audit entry, never the flag itself. Nothing in the runner clears it: applyDescription writes description / title / aiUpgraded and does not touch aiFlagNote (that field is cleared by saveLotDescription, the Review tab's own save, which the runner never calls). ⚠ Measurement-only flags are still dropped by shouldKeepFlag, by design.
`,
  },
  {
    filename: "marketing_plan.md",
    content: `---
name: Marketing Reports -> Business Plan tab
purpose: The saved marketing business plans, their frozen analytics snapshot, the AI suggestions and the PDF. Read before touching anything under /tools/marketing-reports/plan.
last_updated: 2026-08-13
---

# Marketing Reports -> Business Plan (built 2026-08-13)

Jordan's ask: "another tab that lets me create a marketing business plan using data from our analytics for auto suggestions and letting me add them in manually so I can then create a pdf report". He chose saved plans in the database, AI suggestions read from the analytics figures, and all four sections (Where we are now / Objectives & KPIs / Channel plan / Audience & competitors).

/tools/marketing-reports gained a TAB BAR (tabs.tsx, a server component - each page passes which tab it is, so there is no client-side pathname read). Analytics is the old page, unchanged. Business Plan is a new sub-route at /tools/marketing-reports/plan.

ACCESS: app/(app)/tools/marketing-reports/layout.tsx gates BOTH tabs on the MARKETING_REPORTS app permission (hasAppAccess, otherwise redirect to /hub), the same as every other tool. Added 2026-08-13 - before that the pages checked only for a login, so the permission tickbox did nothing here and any logged-in Hub user could open them. hasAppAccess is a strict allowlist (ADMIN always in, everyone else needs the tick), so anyone not ticked in Users & Permissions is bounced.

PLANS ARE SHARED DOCUMENTS (Jordan's decision, 2026-08-13): anyone with access can create and edit any plan and tick off actions; only the creator or an admin can DELETE a whole plan. Do not tighten editing to the owner.

WARNING: THE SNAPSHOT IS FROZEN, AND THAT IS THE WHOLE POINT. MarketingPlan.snapshot (JSONB) holds the Google Analytics figures the plan was written against, stamped with snapshotAt. It is written ONLY when the plan is created and when the user presses the Refresh figures button. Nothing else reads live GA - not the page, not the AI route, not the PDF. A plan that re-read GA every time it was opened would restate today's traffic underneath yesterday's targets, and a target like "sessions 12,430 -> 15,000" would stop meaning anything. Do not "helpfully" make any of those three paths read live analytics.

A plan still works with NO snapshot: creation catches a GA failure and leaves it empty, the page says so and offers Refresh figures, and the PDF prints "No analytics figures were attached to this plan" rather than a blank section.

WARNING: TWO LIBS, DELIBERATELY SPLIT.
- lib/marketing-plan.ts is PURE - channels, statuses, formatters, asSnapshot, snapshotToText, STAT_DEFS. It is IMPORTED BY THE CLIENT EDITOR, so it may only ever "import type" from lib/ga. A value import would drag the @google-analytics/data client into the browser bundle.
- lib/marketing-plan-snapshot.ts holds the ONLY GA read (buildPlanSnapshot) and is server-only. Never import it from a "use client" file.
Same reasoning keeps lib/marketing-plan-pdf.ts (pdf-lib + sharp) out of the page.

The pieces:
- Tables MarketingPlan / MarketingPlanObjective / MarketingPlanAction, objectives and actions cascade-deleted with the plan. NEEDS Run Migrations.
- Server actions in lib/actions/marketing-plans.ts. Every one RETURNS { ok, error } and never throws - a thrown server action is redacted to "An error occurred..." in a production build.
- AI: POST /api/marketing/plan-suggest, using the marketing_plan slot in AI_TOOLS (claudeOk, so it can be pointed at Claude from Admin -> AI Models). The long system prompt is the stable half and goes in "system", which generateAiText already cache-marks for Claude. Never move the figures up there - they change per plan and would invalidate the cache on every call.
- PDF: GET /api/marketing/plan-pdf?id= building lib/marketing-plan-pdf.ts. A4 PORTRAIT, unlike the landscape cataloguing reports, because a plan reads as a document. Its table() takes a measure() callback per row: wrapped detail lines have variable height and a fixed row height would overprint the row beneath.

## Bugs found in the audit the same day - do not undo these fixes

- key={plan.id} on <PlanBody> IS LOAD-BEARING. Switching plans is a search-param-only navigation, which Next 16 deliberately does NOT treat as a state reset (layout-router keys the segment on a cache key computed WITHOUT search params). Without the key every prop-seeded useState in the editor kept the PREVIOUS plan's text, and the next save - or merely clicking into and out of the name box - wrote it onto the newly-selected plan.
- useServerText (React's "adjust state during render" pattern) keeps the summary/audience textareas following the server value. The AI suggestions are appended server-side; without this the box still showed the pre-suggestion text and pressing Save wrote it back over the appended paragraph.
- wrap() must split on newlines BEFORE safeAscii. safeAscii deletes anything outside \\x20-\\x7E and a newline is outside it, so sanitising first glued the last word of one paragraph onto the first word of the next.
- The DONE / IN PROGRESS badge's height is reserved in the channel table's measure() callback. It is drawn at the foot of the row in the same column as the title, so without it a one-line action printed the badge over its own title.
- Delta colours use higherIsBetter, not the sign - in the PDF AND on screen. A falling bounce rate is good news; it was printing red on the PDF while the page showed it green.
- NEVER pass a plain null to the snapshot Json column. Prisma types a nullable Json field as NullableJsonNullValueInput | InputJsonValue and rejects a bare null at runtime - omit the key instead (the house pattern, see lotsSnapshot ?? undefined in the marketing drafts route). Creating a plan while GA was unavailable failed on this.
- run() in the workspace and add() in the modal both catch rejections and call maybeReloadForSkew. The actions return their business errors, but a stale-deploy action miss REJECTS - without a catch the button simply reset and the user believed the save had happened.
- A Google Analytics failure during creation now returns a warning shown in an AMBER box. It used to be a bare catch with a green "Plan created." over the top of it.

What the AI prompt enforces: every suggestion grounded in a supplied figure and quoting it; no invented Vectis facts, budgets, tools or platforms; British English; no use of the word CRM; no internal auction codes (a letter followed by digits); vectis.co.uk as the only URL.

Suggestions are DRAFTS. Nothing is written until the user ticks it and presses Add, each added row is stamped source "ai" and badged AI on screen and in the PDF, and suggested free text is APPENDED to the summary/audience rather than replacing it - accepting a suggestion must never wipe something a person typed.
`,
  },
  {
    filename: "activity_report_lunch_toggle.md",
    content: `---
name: Cataloguer Activity Report - exclude lunch breaks
purpose: The lunch toggle on /tools/reports/activity, and why it is a lens on the report and never a change to what was logged.
last_updated: 2026-08-12
---

# "Exclude lunch breaks" toggle

Jordan: "On this report can we have lunch breaks excluded as a tick box." Lunch was 23% of time away and swamped everything else, so "where does the rest of the time go?" was hard to answer.

ONE place does the work: computeIdleReport(range, includeTamper, excludeLunch) filters reason != "LUNCH_BREAK" IN THE QUERY, so every figure moves together - totals, away-share-of-day, per-person, the chart and the reason table. No figure can disagree with another.

State lives in the URL (?lunch=off), not React state: the page is server-rendered, so a URL means the view can be shared or bookmarked exactly as seen. The range links carry the lunch choice and vice versa, so switching one does not silently reset the other. It is OPT-IN - the report shows everything unless asked, because a shared link must not quietly hide a chunk of someone's day from whoever opens it.

WARNING: the exclusion is STATED on screen and PRINTED ON THE PDF, appended to the period label ("30 days (excluding lunch breaks)"). A report with lunch quietly removed could be read as the full picture in a conversation about somebody's working day, so the scope has to travel with the file. Do not remove that label.

WARNING: this is a LENS ON THE REPORT ONLY. It does not touch the save-gate, evaluateIdleGate, or the Unaccounted Time report - lunch still accounts for a gap exactly as before. It changes what is shown, never what was logged or whether a gap counts as explained.
`,
  },
  {
    filename: "change_vendor_tote_fix.md",
    content: `---
name: Change Vendor sets tote, receipt AND vendor
purpose: Why Change Vendor said "complete" without changing anything, and the two faults behind it. Read before touching the Manage Lots Change Vendor panel.
last_updated: 2026-08-12
---

# Change Vendor — tote included, and 0 updated is no longer "success"

Jordan, on production 2026-08-12: "The change vendor button in here isnt working its saying complete but not changing them it needs to change tote receipt and vendor number."

Two faults, one symptom:

1. **Manage Lots never passed the tote.** setLotsVendorReceipt has taken an optional tote since the End of Day work, but Manage Lots deliberately did not send it ("so its behaviour is unchanged"). Typing a TOTE therefore moved the receipt and vendor and left the lot on its old tote. It now sends the tote whenever the lookup was a tote (vendorHit.kind === "tote"). WARNING: do not restore the old scoping — Jordan asked for all three explicitly.

2. **updated === 0 was reported as success.** "Changed 0 lots" with a tick reads as done. That is exactly what he saw: the ticked lots already had the right receipt and vendor, only the tote was wrong, so nothing differed and nothing was written — while the message said it worked. Zero updated now shows an amber "Nothing changed — already on …".

WARNING: the server action was always correct — it writes only fields that differ, logs through updateLotLogged with source vendor_change, and supports the per-sale Undo. The bug was entirely in the caller. Check the caller before suspecting setLotsVendorReceipt.
`,
  },
  {
    filename: "first_aid_public.md",
    content: `---
name: Facilities -> First Aid (the ONE public page)
purpose: The public /first-aid page and its Hub app. The only route outside the login gate besides /login, /setup and the API relays - and the exact constraints that make that safe. Read before touching auth.config.ts publicPaths or anything under /first-aid.
last_updated: 2026-08-11
---

# Facilities -> First Aid (built 2026-08-11)

Jordan's ask: a new **Facilities** home-page section, with **First Aid** as its first app, and "the link for the first aid page needs to be able to bypass the login screen so anyone can use it but it needs to be secure and not a backdoor into the app". Asked what it should hold, he answered **all four** options - first aiders, kit/defib locations, emergency steps, and an accident-report form.

## Two surfaces, deliberately separate

| | Path | Who |
|---|---|---|
| Public page | **/first-aid** - top-level route | **Anyone, no login** |
| Management app | **/tools/first-aid** | Hub login + FIRST_AID app permission |

Registry wiring: SECTION_DEFS gained FACILITIES (lib/app-cards.ts), AppKey/ALL_APPS gained FIRST_AID (lib/apps.ts), plus the card def. WARNING: a card with **no appKey never appears on the permissions page** - this one has one.

## Why the public page is not a backdoor - keep ALL of these

Written up as its own section in **RULES.md -> "Public First Aid page"**; that is the authority.

- **EXACT-match allowlist.** auth.config.ts now has publicPaths (prefix, startsWith) **and** publicExact (includes). /first-aid is in the **exact** list - a prefix entry would also open /first-aid-anything, so a future page could go public by accident. Never move it.
- **Top-level route, NOT app/(app)** - that group's layout renders the Hub shell and reads the session. No links into the Hub from the page.
- **No public GET endpoint** - the page reads its tables server-side. Photos reuse the pre-existing /api/public/photo prefix allowlist (first-aid/ added to it).
- FirstAider / FirstAidKit / FirstAidInfo are **world-readable models**. Never put anything confidential in them.
- Every read is wrapped so a **missing table cannot 500 the page** - people may be reading it in an emergency.

## The one unauthenticated WRITE

POST /api/public/first-aid-report - under the **already-public** /api/public prefix, so it opened nothing new. Protections, all in the route (client checks are cosmetic):
- **Write-only**: returns {ok:true} and nothing else - no record, not even an id. It cannot be used to read or probe.
- **Honeypot** website field -> answers 200 so a bot learns nothing.
- **Two rate limits**: MAX_PER_IP_PER_HOUR (5) and MAX_PER_HOUR_TOTAL (60) - the second matters because a botnet spread across addresses defeats a per-IP limit alone.
- **IP is hashed with AUTH_SECRET, never stored raw** (ipHash) - only ever compared to other hashes.
- Every field length-capped server-side.

AccidentReport rows are read **only** in the Hub app. Reports can contain **health data about a named person** - recorded in the STORES arrays on **both** /admin/compliance and /admin/dpia, per the standing rule.

## Page order on /first-aid (2026-08-12, Jordan's call)

Report an accident -> Emergency info -> First aiders -> Kits & equipment -> Also worth knowing -> the site plan -> footer. WARNING, UPDATED 2026-08-12: reporting is FIRST, above the emergency panel — Jordan asked twice ("the report an accident should be much more near the top", then "move report an incident to the top"). It had been placed third on the reasoning that follows and that was overruled; his call stands, the 999 button sits immediately beneath it. Do NOT move it back on safety reasoning — it has been raised and decided. Jordan: "order wise the map should be at the bottom of the page the report an accident should be much more near the top." The reasoning, so it is not tidied back: emergency info stays FIRST (nothing outranks the steps, the 999 button and the ambulance address); first aiders second, the next thing needed when someone is hurt; report an accident THIRD, not last — it is the second most common reason to open the page and was buried under everything else; and the plan LAST, because it is the biggest and slowest thing on the page and the least urgent, useful when already hunting for a kit and useless while someone is on the floor. The plan is also the only full-width block, so it splits the narrow reading column and the footer sits in its own narrow block after it.

## The plan FILLS the screen — no scrollbar when there is room (2026-08-12)

Jordan: "Its still not fullscreen. No need for a scrollbar when there is plenty of room here." Two causes: the plan section was max-w-6xl (1152px) — still a centred column, just a wider one, now w-full with modest padding while the prose sections around it stay max-w-2xl; and PlanImage forced min-w-[900px] AND max-h-[70vh] on EVERY screen, so even a 1900px window got a cropped scrolling box. Now min-w-[900px] applies only below sm (a phone needs the drawing wide enough to read and pans instead), with sm:min-w-0, sm:overflow-visible and NO height cap. Desktop shows the whole drawing at full width with no scrollbars; a phone still pans. Do not reintroduce a fixed height or an unconditional min-width — that is what made it look "not fullscreen" twice.

## Symbols blank on the public page — a SERVER/CLIENT boundary bug (2026-08-12)

WARNING: this supersedes the note below, which was a WRONG diagnosis. The kit was not simply typed "Other" — the symbol was blank for EVERY kit whatever its type.

Real cause: components/site-plan-view.tsx is "use client", and the public page app/first-aid/page.tsx is a SERVER Component. A Server Component importing a PLAIN OBJECT from a "use client" module gets a client-reference stub, not the data — components still render, data comes back empty. So PIN_ICON[...] was always undefined there. The original literal fallback ?? "📍" silently masked it, which is why every pin looked like "the default pin"; removing the literal made it render nothing, which is how it surfaced. Isolation that proved it: the identical map renders correctly in the admin pin editor (client) and blank on the public page (server) — same kit, same data, only the boundary differs.

Fix: the maps live in lib/first-aid-icons.ts, a PLAIN module with NO "use client", plus pinIcon()/kindName() helpers. The server page imports from there DIRECTLY; site-plan-view re-exports them for client callers. WARNING: never move shared constants back inside a "use client" file, and never import them THROUGH one from a Server Component — you get the stub back.

WARNING, generalisable: a hardcoded fallback next to a lookup can hide the lookup being broken entirely. "?? 📍" looked defensive and cost a day.

## (superseded, kept for the reasoning) 📍 is the "Other" symbol

Jordan: "why it is a default pin and not an actual symbol like on the other page" — a kit named "Reception Defib Kit" drawing 📍. NOT a bug in the drawing: the symbol follows the kit's TYPE, never its name, and that kit was saved as type Other — 📍 IS Other. Three changes so the answer is visible rather than needing explaining: ONE icon map (app/first-aid/page.tsx kept its own KIND_ICON alongside the imported PIN_ICON, identical and guaranteed to drift — deleted, everything imports PIN_ICON/KIND_LABEL from components/site-plan-view, do not reintroduce a local copy); the key now names the type ("Reception Defib Kit · Other — Reception") so 📍 explains itself; and the admin kits list labels the dropdown "Type — this is what draws the symbol", with the name field showing the symbol and type it will appear as. The dropdown defaults to First aid kit and is easy to leave alone, which is exactly how a defib ends up typed as Other.

## Design philosophy is now a RULE (2026-08-12)

Jordan: "Can we make sure there is a rule on that for design philosophys going forward." RULES.md gained a **Design philosophy** section — read it before building any screen. Six rules, each naming the failure that produced it: (1) use the width you have, narrow columns are for phone-read PROSE only, break data out into its own wider block; (2) dark mode is the DEFAULT here so check dark first, dark: must be the LIGHTER value, and native controls (file, select, date) inherit the browser's black text and vanish — use the shared .file-input class; (3) if a symbol or colour means something there must be a key, and a key listing the real items beats an abstract legend; (4) borrow the real world's convention (first aid is green, ISO 7010 — red means fire), keeping red for errors and destructive actions; (5) build for the iPads — ~44px touch targets, and touch-action: none on any drag inside a scrolling panel; (6) never let "nothing happened" look like success.

## Layout: the plan breaks OUT of the reading column, and it has a KEY (2026-08-12)

Jordan: "we are doing this thing where we dont use the full screen again so the plan is all squashed and there is no key. Its very poorly laid out." Both fair — the first is the standing full-width rule being broken again.

The public first aid page is deliberately a narrow phone-first reading column (max-w-2xl) for the emergency steps, first aiders and the form. The PLAN SECTION IS NOT: it breaks out to max-w-6xl in its own block between them, because a 1:1250 site drawing squeezed into 672px is unreadable, which defeats the point of putting it there. Do not tidy the plan back inside the reading column. A KEY sits under it listing every pinned item with its symbol and its whereText — emoji on a drawing mean nothing on their own, and the key doubles as the list of what is marked. The page uses plain divs rather than main for these blocks, since the plan splits the column in two and two main elements would be invalid.

Native file inputs render "No file chosen" in the BROWSER's own colour (black), invisible on this app's dark theme — dark is the DEFAULT here, not the exception. Fixed with a shared .file-input class in globals.css styling both the text and ::file-selector-button in light and dark. Use it on any new visible file input; the ones in photo-upload-tab are sr-only so they do not need it.

## Site Plan — shared, in Facilities (2026-08-12)

Jordan: "I also have this building plan id like the ability to have it in the app so I can mark on it where the equipment is." Asked where it should live, he chose a SHARED Facilities plan, not a First-Aid-only one — so fire extinguishers, stopcocks etc. can mark up the same drawing later without a second copy to keep in step.

/tools/site-plan (app key SITE_PLAN, Facilities section) owns the drawing: upload, rename, reorder, replace, delete. Deleting a plan CLEARS the pins that pointed at it, or kits keep a position on a plan that no longer exists. Pins live on the owning record, not in a shared pin table — FirstAidKit.planId/pinX/pinY — because a shared table would let a deleted kit leave an orphan pin; a future app adds the same three fields to its own model.

WARNING: x/y are PERCENTAGES of the image, never pixels — the plan renders at wildly different widths on a phone, a monitor and a printout. components/site-plan-view.tsx is shared by the Site Plan app, the First Aid pin editor and the PUBLIC page so a pin sits in the same spot in all three, and the click maths measures the img's own rect, not the wrapper (a wrapper can be wider than the picture and the pin would land off-target).

Marking up needs the FIRST_AID permission, not SITE_PLAN — a first aider should not need the plan app to say where a defibrillator is. Uploading the drawing needs SITE_PLAN.

WARNING: the plan is shown on the PUBLIC first aid page — the image and its name are world-readable, so never upload a drawing with anything confidential on it. site-plans/ was added to the public photo proxy's prefix allowlist. Images only; PDFs are refused with the reason given, because pins must sit on a plain image and the server cannot rasterise a PDF.

WARNING: the drawing is fine line work on a mostly-white sheet (1:1250 at A4). Scaled to a phone it is unreadable, which would make the pins pointless — so the viewer keeps a 900px minimum width and SCROLLS, capped at 70vh, with an "Open the plan full size" link for native pinch-zoom. Do not tidy that into a plain fit-to-width image.

## The accident book (BI 510) — 2026-08-12

Jordan: "the report an incident needs to be based off an official workplace first aid book." The form follows the UK statutory accident book (BI 510) structure.

**Part 1 injured person, Part 2 who reported it, Part 3 the accident** are on the PUBLIC form, with a "was it you or someone else?" toggle so the reporter's details are not asked twice. **Part 4 is EMPLOYER ONLY**: date reported, recorded by, RIDDOR reportable (yes / no / not decided yet — an undecided question must never look like a considered "no"), HSE reference, notes. WARNING: Part 4 exists ONLY in the Hub (saveAccidentReportEmployer, behind the FIRST_AID permission) and must never be added to the public form — the paper book reserves that section to the employer for the same reason. Completing Part 4 is the sign-off.

WARNING — asked and answered: Jordan confirmed the form must stay submittable WITHOUT logging in, with results reaching only /tools/first-aid behind login and permission. Do not move the form behind the login: agency staff, contractors and visitors have no account and are exactly who needs it.

Address fields are optional and say so — it is a public form and nobody should be blocked from reporting an injury because they will not type their home address into it. happenedOn is a real DateTime but the raw string is also kept in happenedAt, so a date that will not parse does not silently vanish from an accident record. Retention is stated as three years and recorded on /admin/compliance and /admin/dpia, which now note this is ROUTINE special-category health data, not merely possible.

WARNING: NOT certified as legally compliant. The structure follows BI 510 and RIDDOR as understood, but sign-off is for Vectis's H&S people — Jordan was told this plainly. Do not claim otherwise.

## Colour scheme: GREEN, not red (2026-08-12)

Jordan, on seeing the first build: "the colour scheme being red and not green is not a good idea haha" — right beyond taste. **First aid signage is green and white (ISO 7010); red means fire equipment or prohibition.** A red first aid page signals the wrong thing to exactly the people most likely to need it. Everything identifying the feature is now green: the public page header, the emergency panel, the 999 button, the avatars and address box, the Hub card, and the management tabs and Save buttons.

WARNING: reds that remain are deliberate and correct — do NOT sweep them green: the submit-error line on the public form and the message line in the Hub app (errors ARE red), and the Remove button hover on first aiders and kits (a destructive action). The 999 button is green like the rest rather than red — mixing red back in for urgency would undo the very signal the standard relies on, and it is already the largest element on the page.

## Still open

- **Nobody is notified** when a report arrives - it just appears on the Reports tab with a count badge. If that matters, an email/ntfy hook is the obvious next step (not built, not discussed).
- The public page is robots: noindex but is genuinely public - anyone with the URL can read the first aiders' names and phone extensions. That was the point, but it is worth knowing.
`,
  },
  {
    filename: "locking_check.md",
    content: `---
name: Locking Check — the final gate before BC and the website
purpose: The pre-lock screen and what it checks. Two tiers, and it reuses the existing checkers rather than growing its own copies. Read before adding a check to it.
last_updated: 2026-08-14
---

Jordan, 2026-08-14: "I want this as the final screen I can check before I sync everything up with BC and put it live on our separate website."

TWO TIERS, and the distinction is the whole point. **Blocking** means it would reach BC or the website WRONG. **Worth a look** means nobody has confirmed it, and it never blocks.

Blocking: no description; no photos; no barcode; no condition UNLESS the lot is aiExcluded; estimate missing, backwards (70 to 50) or zero; the title not matching the first 83 characters of the CURRENT description; and every issue lib/tote-check.ts reports for tote, vendor and receipt against BC.

WARNING: the condition exemption is Jordan's rule — an AI-excluded lot is hand-written and its condition is typed into the description rather than graded on the lot, so requiring a graded condition there would flag every one of them.

WARNING: the title check exists because editing a description does NOT regenerate the title. The stale title is what goes to BC and onto the website, and nothing else notices.

Worth a look: flagged in Review (reviewFlag); AI flagged a possible cataloguer mistake (aiFlagNote); no category; title over 83 characters; leftover AI text (markdown asterisks, a FLAG: line); and a condition that is graded on the lot but missing from the description, via checkConditionInDescription.

WARNING: the BC part is NOT re-run here — it READS /api/catalogue/tote-check. That route already runs lib/tote-check.ts server-side and returns { checked, clean, rows, lastSync }, where rows is only the lots that FAILED. The first version guessed at a "totes" field the route has never returned, so the screen quietly reported "BC data unavailable" on every sale while the data was perfectly up to date. An empty rows array means every lot is clean, which is a successful check and not a failed one. The last sync time is displayed so a pile of "tote not found in BC" reads as a stale sync rather than as 600 mistakes.

WARNING: it REUSES the existing checkers — lib/tote-check.ts is the same code behind the Tote Check tab, lib/condition.ts is the Description Copier's. Do not grow a second copy of either here; they would drift and the two screens would start disagreeing about the same sale.

WARNING: if the BC tote data fails to load, the tote, vendor and receipt checks are SKIPPED, an amber notice says so, and the "nothing is blocking" banner is withheld. Silently passing every lot would have the screen declare a sale ready when the part it could not test is the part most likely to be wrong.

AI-SUGGESTED CONDITIONS (2026-08-14). Jordan asked for a mass way to fill missing conditions using our grading system. WARNING: that CONFLICTS with the standing rule that condition is added by a human and must not come from the AI — the Model Railway presets had "condition appears Excellent to Near Mint" removed on purpose. It was raised under the conflict protocol and Jordan chose "suggest, human accepts", so the reversal goes exactly that far and no further.

/api/auction-ai/suggest-condition (slot condition_suggest) grades from the PHOTOGRAPHS, returns only words from CONDITION_GRADES, and gives a reason and a confidence. WARNING: it writes nothing, and it REFUSES to grade a lot with no photos — grading from the description's adjectives is precisely the guess this must not make. Invented grades like "Very Good" or "C8" are filtered out, since nothing else in the app could parse them. The review list sits on the Locking Check under the checklist; every row is an editable dropdown with a "leave blank" option, and nothing reaches a lot until Accept is pressed. Writes go through bulkSetLotConditions with source "ai_condition", so an AI-suggested grade stays identifiable in the Lot Change Log for ever.

WARNING: low confidence means the AI could not see enough — sealed, boxed, distant or partial photos. Those are the ones to read rather than skim. A photograph cannot show hidden damage, missing parts, mechanical function or the inside of a box.

A CHECKLIST lists every criterion with passed / in-scope, e.g. "Has a condition - 496 / 496"; clicking a failing row filters the table to just those lots. WARNING: the denominator is the lots the criterion APPLIES to, so the condition row excludes AI-excluded lots rather than reading 496/635 and looking broken. A criterion skipped because the BC data is missing shows a dash and "not checked", never a tick.

WARNING: titleFromDescription now lives in lib/lot-title.ts and BOTH the Generate Titles action and this check import it. It used to live privately inside lib/actions/catalogue.ts, so this screen wrote its own copy from the description in RULES.md — and got it wrong twice over: it kept the newlines (the generator collapses them to spaces) and truncated at 83 instead of 82 plus the ellipsis. The result was 634 of 635 correct titles reported as mismatched. Never re-derive in a checker a rule that already exists in code; import the real one.


⚠⚠ 2026-08-20 - "SUGGEST CONDITIONS DOESNT DO ANYTHING" - AN EMPTY CATCH AGAIN. On F110 the button ran, the counter went 1/6 to 6/6, and nothing appeared. THREE SILENT FAULTS: (1) catch { /* one lot failing must not stop the run */ } was COMPLETELY EMPTY, so a rate limit, a block or a parse failure all looked like success; (2) no res.ok check, and if (j?.grade) meant an error body was ignored without even reaching a catch; (3) btoa(String.fromCharCode(...new Uint8Array(buf))) overflows the stack on a large photo, and that threw INSIDE the empty catch. On top of that it fired every lot back to back with NO GAP against a measured quota of 4 requests a minute, so past the first couple they were all refused anyway. FIXED: res.ok checked and the error surfaced, chunked base64, adaptive pacing (8s doubling to 60s on refusal, easing back after three clean), rate limits retried up to 4 times with a visible "Waiting - the AI is rate limited" message, and a final tally "Graded 4 of 6. 2 could not be done - ...". ⚠ The message was rendered ALWAYS IN EMERALD GREEN so a failure read as success; it now colours by outcome. ⚠⚠ THIS IS THE THIRD EMPTY-CATCH FAILURE IN THIS CODEBASE (Auto Pipeline's Apply All, the Review tab's Auto-fix, now this). Look for a loop over lots with a catch {} justified as "one failure must not stop the run" - not stopping is right, SAYING NOTHING IS NOT.`,
  },
  {
    filename: "manual_cataloguer.md",
    content: `---
name: Cataloguers who write their own descriptions (User.manualDescriptions)
purpose: A per-user tick that hides Key Points in the wizard and marks EVERY lot that person creates as excluded from AI — enforced on the server, not by them remembering the box. Read before touching any lot-creation path.
last_updated: 2026-08-14
---

Jordan, 2026-08-14: "I need to be able to tick cataloguers as excluded from ai so they dont get the key points field and it just auto excludes them for every lot they make in the wizard. This is in an effort to combat a bug as cataloguers are making lots like this where they have somehow typed the description but it hasnt been marked as excluded from ai."

**User.manualDescriptions** (Boolean, default false), ticked in Admin → Users → the person → Cataloguing Settings, at the bottom of that section.

WARNING: the SERVER is the enforcement; the wizard is only the visible half. writesOwnDescriptions(userId) in lib/actions/catalogue.ts is ORed into aiExcluded on EVERY creation path: createLot (wizard and tablet), createPhotoOnlyLot, importLots, massCreateLots and createLotsFromLottingUp. Hiding the tickbox on its own would have left the original bug alive on every other screen — the whole point is that it cannot be forgotten.

In the Lot Wizard, step 3 shows the description field directly for these users: no Key Points, no tickbox, just a line saying their lots are excluded automatically. The flag is threaded page → auction-tabs → lot-wizard-tab.

WARNING: the lookup is wrapped in try/catch because the column arrives with the SQL and not with the deploy — a missing column behaves exactly as before rather than breaking lot creation. For the same family of reasons auth.ts still uses an explicit select; a User column plus a bare select is the documented LOGIN LOCKOUT.

WARNING — worth revisiting: this also marks Photo Only, Import, Mass Create and Lotting Up lots as excluded, because the choice was "every lot they create". Those paths exist to create lots FOR the AI to describe, so if such a person uses Photo Only their lots will never get an AI description. This was flagged at the time; narrow it to createLot only if it bites.

⚠⚠ 2026-08-19 — EXCLUDE FROM AI ADDED TO THE TABLET LOT VIEW, AND THE SILENT UN-EXCLUDE IT FIXED. Jordan: "in the tablet cataloguing in the lot view there is no button to exclude something from Ai incase a cataloguer changes their mind and whats to go back and do it manually". It was not merely missing: extractLotData reads aiExcluded: formData.get("aiExcluded") === "true", and the tablet form carried NO such field, so null === "true" wrote FALSE on every save. Any lot excluded anywhere else — including one force-excluded at creation because its cataloguer is flagged manualDescriptions — was quietly put back in the AI's path the moment someone opened and saved it on a tablet.
Guarded against a repeat: the value is held in React state and ALWAYS written with fd.set("aiExcluded", …) in handleSubmit, alongside condition/notes/category which are handled the same way. A plain checkbox would not do — an unchecked HTML checkbox posts nothing, which is the exact shape of the original bug.
⚠ The lesson generalises: extractLotData turns EVERY absent boolean into false. Any new form calling updateLot must post every boolean it does not intend to clear. Checked at the time — the two desktop call sites (autosave and submit in auction-tabs.tsx) both build their FormData from the form containing the checkbox, so the tablet was the only hole.
The control is a full-width tappable row above the Description field (which is what it governs), amber when on, stating the effect both ways — sized for the shared iPads rather than a desktop-sized checkbox. TabletLotEdit is mounted with key={editingLotId} and fully remounts on Prev/Next, so the useState initialiser re-runs per lot and cannot carry a value between lots.
`,
  },
  {
    filename: "screen_position_and_copier_conditions.md",
    content: `---
name: NEVER move what is already on screen + the Copier's condition check
purpose: The Description Copier's layout is frozen because the macro reads it by screen coordinates — and ONLY that page. Plus why the Copier was flagging 139 lots that were perfectly fine. Read before changing the Copier's layout.
last_updated: 2026-08-14
---

# WARNING: the DESCRIPTION COPIER's layout is frozen — and ONLY that page

Jordan, 2026-08-14: "Its also very important this appears underneath what was already there as moving elements on the screen will break the macro this should be marked as a very important rule."

His **AutoHotkey macro** reads the **Description Copier** by **screen coordinates** while it types into BC. Move anything on that page and the macro types into the wrong field — **silently, overnight, with nobody watching**.

WARNING — scope, which he gave the same day: "The macro only touched the description copier everything else is fine to be moved around." **Every other screen in the Hub can be rearranged freely**; layout there is an ordinary design decision. Do not apply this rule beyond the Copier — an earlier draft did, and it would have made every future screen needlessly conservative.

On the Copier itself, written up as RULES.md → Design philosophy rule 6:
- The **lot card and its Copy Description buttons come FIRST**. Banners, warnings and summaries go BELOW them. Anything above the card moves the card.
- **The page's height must not vary with the data.** A banner that grows with the number of flagged lots shifts everything beneath it on some sales and not others — just as damaging as putting it above. Keep it collapsed by default, or below the working area, or both.
- Making an existing element **taller** counts too — an extra line of text, a label that wraps.
- If something genuinely must sit above the card, **ASK FIRST** — it means re-recording the macro.

# The Copier was flagging 139 lots with nothing wrong with them

"139 of 635 lots need a condition adding … they need grading first" — on lots whose descriptions already ended "Condition appears Good to Excellent."

checkConditionInDescription (lib/condition.ts) returned **none-recorded** the moment the lot's condition FIELD was empty, **without ever looking at the description**. Two real cases were being mislabelled, both of which Jordan predicted:

1. **The condition was typed into the description instead of being graded on the lot.** The description is the only thing the Copier copies, and it already stated the condition — nothing to add. New state **only-in-description**: shown as a quiet note, NOT counted as a problem, because the only thing outstanding is the lot's own blank condition field, which is tidied elsewhere.
2. **No description at all** — typically a lot excluded from the AI. Saying "the description has no condition in it" about a lot with no description sends someone to fix the wrong thing. New state **no-description**, counted and worded as needing a description written.

WARNING: order matters in that function — check for an empty DESCRIPTION before an empty CONDITION, or a lot with neither is reported as a grading problem when it has not been written yet.
`,
  },
  {
    filename: "induction.md",
    content: `---
name: Facilities -> Induction (slides + signable forms)
purpose: The Induction PowerPoint rebuilt as admin-editable slides with a presenter view, plus the forms a new starter reads and SIGNS on the tablet, and the signed records with a PDF export. Read before touching /tools/induction or anything that signs in the Hub.
last_updated: 2026-08-14
---

# Facilities -> Induction (built 2026-08-14)

Jordan's ask: "In the facilities I want to make an induction/onboarding section", starting from the company Induction PowerPoint ("its very out of date and could do with updating and could be inside the app"), then "I have some forms I want putting in the app they can sign".

## The flow it is built around — this is why the shape is what it is

**An admin runs the slides on a BIG SCREEN on one device, and hands a TABLET (logged in as themselves) to the person being inducted for the forms.** Jordan, verbatim: "We will log into the tablet as an admin and give them the forms to read and sign. The powerpoint will also be ran by an admin on a bigger screen on a separate device."

WARNING - the single most important consequence: **the person signing is NOT a Hub user and has no account.** They may not even be an employee (agency, contractors, other Hambleton Group companies - the company field is a free-text box at Jordan's request: "Other companies as well its just needs to be a text field the user will type in").

So this **cannot reuse the AUP terms gate** (components/terms-gate.tsx / TermsAcceptance), which keys everything to session.user.id. Only the *mechanism* was reused - read, then draw a signature on a canvas, composited onto white before saving. The name, company and job title are TYPED IN, and takenById/takenByName record which member of staff was signed in. I said "reuse it" early in the conversation and had to correct that; do not try again.

## Three surfaces

| | Path | What |
|---|---|---|
| Tool | **/tools/induction** | Four tabs: Run the induction / Records / Slides / Forms |
| Presenter | **/tools/induction/present** | The deck full-screen (fixed inset-0 OVER the Hub shell, still inside (app) so the permission gate applies once). Arrows or space, N for presenter notes, Esc to finish. ACTIVE slides only. |
| Signing | (no route) | components/induction-sign.tsx - a full-screen overlay. Deliberately covers the Hub nav: a new starter is holding the tablet. |

Wiring: AppKey/ALL_APPS gained **INDUCTION** (lib/apps.ts) and a card in the FACILITIES group (lib/app-cards.ts). A card with no appKey never reaches the permissions page - this one has one.

## The four slides that read LIVE data — the whole point of moving it off PowerPoint

The deck listed the first aiders, the kit locations and the two defibrillators **by hand**, so it was wrong the moment anyone left. InductionSlide.liveBlock (NONE | FIRST_AIDERS | KITS | DEFIBS | SITE_PLAN) renders those from the **First Aid / Site Plan records at presentation time** instead. Only ACTIVE FirstAider rows - an inactive first aider has left or lapsed, and putting them on an induction slide is the exact failure being fixed.

WARNING: an empty live block does NOT render nothing - it says which record is missing and where to add it. A blank slide in front of a room reads as "the screen is broken".

## Slides are DB rows, seeded once

lib/induction-seed.ts holds the 19 slides as starter content and seeds ONLY a completely empty table (same rule as lib/auction-ai-presets.ts) - **editing that file does not change a seeded environment**, edit the slides in the app. Body text is plain: a blank line starts a paragraph, a line starting "- " is a bullet. YouTube links embed (the deck's three videos: defib demo, manual handling, box cutter); a non-YouTube link renders as a link, never an empty black box.

Carried over with the typos fixed ("the the gravel car park", "its is important"), Americanised spelling corrected, the blank slide 2 and the "Thank You" slide dropped.

WARNING - left for the H&S team, not silently reworded: the original emergency slide said **do not attempt CPR unless trained**. Current UK guidance is that the 999 call handler talks an untrained bystander through compressions. That line was left OUT and the reason put in the slide's **presenter note** for the H&S team to decide. Do not quietly restore or rewrite it - it is a clinical call, not a copy-editing one.

## Forms and the signed record

InductionForm (key, title, intro, body, declaration, ask* toggles) + InductionFormItem (the tick list). Two seeded: **fob-terms** (the Electronic Access System letter + acceptance form merged into one - swipe in/out, no piggy-backing, wages + fire roll-call, do not remove from the holder, GBP 15 replacement) and **induction-signoff** (15 points drafted from the deck, countersigned by nobody - see below).

WARNING: **InductionSignature has NO foreign key to InductionForm, on purpose.** The form stays editable and deletable; a signature whose wording changed underneath it, or vanished with the form, is worthless as evidence. The row snapshots formTitle, bodySnapshot, declarationSnapshot and items (the label + ticked state of every point). Deleting a form does not touch anything signed. The PDF prints the SNAPSHOT, never the live form.

Required ticks are re-checked SERVER-SIDE in signInductionForm - the browser check is cosmetic, and this row is the record that says someone confirmed each point.

Deleting a signed record is **ADMIN only**; the INDUCTION permission is enough to take a signature, never to make one disappear.

## PDF

lib/induction-pdf.ts + /api/induction/pdf?id= - A4 portrait, pdf-lib, Vectis letterhead (RULES: never pdfkit). Jordan: "I think its best it lives in the hub but we can export a pdf version if needed", so the Hub is the record and the PDF is the personnel-file copy. An UNticked line prints as [ ] in red with a warning under the list, and a signature image that will not decode SAYS so - a blank space under "Signature" would read as an unsigned form.

## Compliance

Recorded in the STORES arrays on **both** /admin/compliance and /admin/dpia, per the standing rule, plus a DPIA data-subject entry, a data-category entry and a lawful-basis row. These are the only people the Hub holds data on who have **no account and no other footprint in it**, and a drawn signature is the strongest single identifier here. Retention is not automatic - it is flagged as something to set alongside the personnel file.

## Not built (not asked for)

No completion tracking across a person (each form stands alone), no email to HR, no per-person induction "record card", and the slides are not printable. Ask before adding any of it.

## AI helpers, presenter redesign and a three-agent review (2026-08-14)

Jordan: "could we have a re-write with ai that also check what we are saying is correct and legal. An AI to check if anything is missing/recommendations. The slide is also very boring looking."

**Two AI helpers.** Slots induction_rewrite / induction_review (lib/ai-models.ts, both claudeOk); the prompts, the UK legal standard they judge against and the deck serialiser live in **lib/induction-ai.ts**. Per slide, **Rewrite & check** rewrites it AND lists what was wrong legally or factually; across the whole deck plus both forms, **Review the induction** reports what is wrong and what is missing.

WARNING: neither ever writes to a slide. The answer comes back for a person to accept or discard, and applyInductionSlideText is the only write path — it can touch title/subtitle/body and nothing else, so an AI cannot change the layout, the live block or whether a slide is even in the running order. Every panel carries a standing "not legal advice" line. Same stance as the accident book, which is deliberately not claimed to be certified.

**Presenter redesign.** It looked like a document, because all 21 slides used one layout and every non-bullet line rendered bold — a heading and the paragraph under it were indistinguishable. Now: InductionSlide.**layout** (TITLE | CONTENT | STATEMENT); parseSlideBody returns "h" blocks (a short line with no full stop, or an explicit "## "); a **fit-to-height scaler** so a slide never scrolls in front of a room, with a visible warning badge when it hits the floor and would clip; chrome that fades while presenting; click-to-advance; F for full screen.

WARNING: offsetHeight reports the LAYOUT box, which a CSS transform does not affect — that is why measuring while already scaled cannot feed back into itself. WARNING: the faded control bar must keep pointer-events-none, or on a tablet the tap meant to bring it back lands on "Finish". WARNING: long bullet lists use CSS **columns**, not a grid — a grid fills left-to-right, so someone scanning down the left column reads items 1, 3, 5.

**Three review agents (correctness/security, record integrity, UI vs RULES.md) found real bugs. All fixed:**
- A signature could be saved **BLANK**. The canvas only exists on step 2, so stepping Back and forward again mounted a fresh empty one while hasSig stayed true — Submit stayed enabled and the blank white PNG passed every downstream check. Now reset with the step, plus a real ink check before submit.
- The snapshot was re-read from the DB at submit, but the screen rendered from props loaded earlier — a form edited on another device mid-signing was stored as what the person "agreed to". formUpdatedAt is now sent and a mismatch is refused.
- items stored only the label, so the PDF printed every OPTIONAL blank in red under "were NOT confirmed" — flagging good records as defective. required and detail are now stored.
- Seeding was racy (two tabs = 42 slides) and a partial seed was permanent (the count guard meant a failed second form could never seed again — and that one is the actual H&S sign-off). Now a pg_advisory_xact_lock plus a per-form key check.
- ensureInductionSeed was an exported server action with **no permission check** — the only export in the file without one.
- R2 orphans: the image uploaded before validation, and replacing one never deleted the old object. (lib/actions/first-aid.ts has the identical hole — not fixed here.)
- takenBy recorded the IMPERSONATED user, so a record could name someone who was nowhere near it.
- The PDF stripped accented characters, printing "José Fernández" as "Jos Fernndez" on a personnel record. WinAnsi encodes that range; only the strip was over-aggressive.
- The Records tab shipped **every stored signature PNG on every page load**, whichever tab was open — megabytes of other people's signatures sent to a tablet about to be handed to a stranger. Now /api/induction/signature fetches one at a time, and the 500-row cap is stated on screen instead of silently hiding older records.

**Backup gap closed:** the four induction tables are now in the nightly backup. WARNING: the **First Aid** tables are still missing from it — the same gap, deliberately not fixed in this pass.

**Raised and left for Jordan:** deleting a signed record still leaves no audit row; there is no way to record "unable to sign" (so the one person whose induction most needs documenting produces no record at all); no field for the fob/card serial number the access form creates a liability against; and the inductor never counter-signs.

## Auto-apply, and slides that look designed (2026-08-14, later)

Jordan: "After we do a review can we get an auto apply for the feedback also the plain black slides still look terrible. There is no vectis logo images and infographics."

**Auto-apply.** Every finding that names a slide gets a "Fix this" button, plus a "Fix all" that groups findings BY SLIDE so a slide with three findings is rewritten once rather than three times over the top of itself. /api/induction/ai/fix uses **FIX_SYSTEM**, a deliberately narrow prompt: resolve these exact issues and change nothing else.

WARNING: that narrowness is the safety property, not fussiness. If applying one finding could come back as a wholesale rewrite, there is no way to check the result against what was reported — and the wording being rewritten is wording the company has already agreed.

WARNING: findings with **no slide** against them, and everything under "what is missing", are never auto-applied. They need a person to decide what the company is committing to, and they say so on screen.

WARNING: the review only returns a slide TITLE, and duplicate titles are legitimate in this deck — "Legal responsibilities" appears twice. An ambiguous match is **refused with an explanation**, never guessed at; fixing the wrong slide silently would be worse than not fixing it.

**The look.** Every slide now carries the Vectis mark and an accent rule (larger on a title slide). New **layout: CARDS** turns a bullet list into tiles, splitting "Heading — detail" the way people already write bullets, used for the hazards, objectives and contacts slides. New **graphic** field: STEPS renders the slide's own bullets as a numbered flow with a ghost numeral, and EXTINGUISHERS draws the BS EN 3 UK colour code as it appears on the extinguishers in the building — red body, coloured band — instead of five more bullet points (RULES rule 4: borrow the real world's visual language).

WARNING: neither graphic invents content. One restyles the slide's own words; the other draws a published standard. A decorative picture that asserts something the company has not agreed to is exactly what an induction must not have — do not add "illustrative" graphics that carry meaning of their own.

WARNING: **the one-off migration that gives the already-seeded deck its layouts and graphics is guarded on "graphic" IS NULL, and the last statement stamps every remaining slide.** So the whole block can only ever touch a row once, and re-running Run Migrations can never undo a choice made afterwards. Copy that pattern for any future backfill of seeded rows — guarding on the value itself would clobber the user's edits every run.

WARNING: **the Vectis logo on a dark slide — the PADDING is the fix, not the alignment.** Measured off /public/vectis-logo.svg: the ink runs edge to edge (0 to 896 of 900) and the text block — the blue bar and the red strapline — centres at **59.7% across, not 50%**, because the V's swash sticks out to the left. With a plate that hugs the artwork the eye centres the wordmark, which is 10% right of the box, so it reads as off-centre however it is aligned, and nudging cannot fix it: move the logo inside the plate and the padding goes lopsided, move the plate and a white box sits off-centre under a centred title. A **generous, evenly padded** white plate makes the symmetric white shape the thing being centred — which is exactly how the hand-made version looks. Do not tighten that padding to "hug" the logo. Use a rounded rectangle, never a pill: the artwork is already an oval lockup and two curves never look aligned. The proper fix is a reversed/white logo asset used with no plate at all — we do not have one, and recolouring the company logo is not a developer's call.

WARNING: **"The AI did not return usable JSON" was OUR bug, not the model's.** Two of the four fixes on the first real run failed that way. These prompts ask for a slide BODY, which is multi-line by definition, and a model writing JSON freehand routinely puts a real newline inside the string instead of \\n — which is invalid JSON, so a perfectly good rewrite was thrown away. All three induction AI routes now use **parseAiJson** (strip a code fence, take the outermost braces, escape raw control characters inside strings) plus **one retry with STRICTER_JSON** before giving up. Reuse parseAiJson in any route that asks an AI for JSON containing multi-line text. And a failed fix keeps a "Try again" button — a transient parse failure must not be recorded as a final outcome.

WARNING: both new columns arrived after the table existed, so loadInductionSlides tries the full select and **falls back to the columns that already exist** — without it, the deploy that adds a column blanks the entire deck until the SQL is applied, which reads as "there are no slides to show" in front of a room. For the same reason, **never use a bare findUnique on InductionSlide**: that is exactly what broke the AI rewrite route on every slide, because it selects every column including one that did not exist yet. Same trap RULES.md documents for the login query on the User table.
`,
  },
  {
    filename: "auto_pipeline_apply.md",
    content: `---
name: Auto Pipeline — what "applied" means (appliedDesc)
purpose: Why lots reappear in Review & Apply after an auto-apply run. PipelineLot.appliedDesc is the ONLY record that a lot was applied — persist it on every auto-apply path. Includes the 2026-08-13 root-cause fix for "auto-apply isn't applying". Read before touching the pipeline stages, the apply path or needsReview.
last_updated: 2026-08-13
---

# WHY "AUTO-APPLY ISN'T APPLYING" KEPT COMING BACK (root cause, fixed 2026-08-13)

Jordan, on a 512-lot Trains sale with Auto-apply selected: all three stages finished, then "512 lots need reviewing & applying" and an Apply All button. His run log held the answer — every catalogue write had failed with Server Action "60b949e1..." was not found on the server, i.e. DEPLOY SKEW (deploys had landed while his tab was open).

A 30-agent review found one root cause and one nearly-as-bad partner. Both are fixed in app/(app)/tools/auction-ai/page.tsx.

1. EVERY APPLY HAD ITS OWN catch THAT ONLY WROTE A LOG LINE — no skew detection, no retry, no counting, no stopping. One deploy turned the rest of the sale into silent no-ops while the run still ended "Pipeline complete!". The apply also sat OUTSIDE withRetry, so the Gemini call retried forever while the catalogue write got zero retries. There is now ONE applyDescription() helper that every stage AND both Review & Apply buttons go through: three retries for transients, and on a stale deploy it sets cancelRef, raises a full amber banner with a Reload button, and STOPS the run instead of repeating a guaranteed failure hundreds of times. It deliberately does NOT call maybeReloadForSkew — reloading mid-run would abandon the run; the stage state is in the database, so Reload then Load Auction then Resume carries on from where it stopped.

2. acceptKP's CATCH WAS COMPLETELY EMPTY. Pressing Apply All (512) on a stale page churned through all 512 lots, wrote nothing, put them all back and left the button reading the same number — the literal "I pressed apply and nothing happened". acceptKP now returns success/failure, and acceptAllKP tallies and states the outcome.

Also fixed in the same pass: autoApply is read through autoApplyRef, because the stage functions held the value from the render that STARTED the run, so toggling the mode mid-run changed the screen and localStorage but not what the run did; saveLot now checks the HTTP status and retries, where before it ignored it entirely, so a dropped appliedDesc silently put an applied lot back into review; the run log states the mode at the start; and a run with failed writes gets its own red banner instead of the same amber "N lots need reviewing" box that a deliberate review-mode run gets.

THREE RELATED THINGS JORDAN HAS ALREADY DECIDED (2026-08-13) — do not re-raise them:

1. THE APPLY MODE IS NO LONGER REMEMBERED. It used to persist to the pipeline_auto_apply localStorage key, which is per BROWSER and not per person, so whoever last chose "Review all before applying" on a shared PC or iPad silently set the mode for the next person's run and their sale quietly applied nothing. Every run now starts on Auto-apply and "Review all" lasts for that session only. Do NOT reintroduce the localStorage read/write. The key may still exist in old browsers; nothing reads it.

2. THE CATALOGUING vs AUCTION_AI PERMISSION MISMATCH IS LEFT AS IS. requireCataloguer demands the CATALOGUING grant while the Auction AI page is gated on AUCTION_AI, so in theory somebody holding only AUCTION_AI would have every apply fail. Jordan: "Its only ever used by admins who should have all permissions." Admins bypass the check entirely, so this is not worth the change. Leave requireCataloguer alone.

3. APPLY ALL DELIBERATELY OVERWRITES NEWER HUMAN EDITS. Because appliedDesc falls back to the live catalogue description when it is null, Apply All can write the AI's older text over a lot a cataloguer has since corrected by hand. Jordan chose "Overwrite anyway" — Apply All always wins, because it is simple and predictable. Do NOT add a skip-if-edited guard or a side-by-side compare without asking again.

# Auto Pipeline — the apply model (/tools/auction-ai, Auto Pipeline tab)

Stage order is **Batch → Key Points → Double Check** (\`page.tsx\`: \`runBatchStage\` → \`runKPStage\` → \`runDoubleCheckStage\`).

⚠⚠ **"Auto-apply" means ALL THREE stages write to the catalogue — including Double Check (Jordan, 2026-08-10: "I just want auto apply to mean auto apply").** This **REVERSES** the earlier "DC is the final MANUAL Review & Apply gate" decision — do not restore it. On **⚡ Auto-apply** a finished run leaves nothing to press; on **👁 Review all before applying** every stage holds its text for the manual gate. \`kpRevised\` drives the review UI in both modes, so the review path still exists and still catches anything whose apply failed.

## The one invariant

**\`PipelineLot.appliedDesc\` is the only record that a lot's text reached the catalogue.** The entire Review & Apply list is one comparison:

\`needsReview(l) = !!l.kpRevised && l.kpRevised.trim() !== l.appliedDesc.trim()\`

and on load \`appliedDesc = saved.appliedDesc || catalogueLot.description\`.

⚠ **Every path that applies MUST persist \`appliedDesc\` via \`saveLot\`, and only after the write succeeded.** Otherwise the fallback silently re-derives "was this applied?" from the **live catalogue text** — so any *later* edit to that description (a cataloguer fixing wording, the Review tab, anything) makes them differ and the lot **reappears in Review & Apply as if it had never been applied**. That is the "auto-apply is ticked but I still have to press Apply all" bug (Jordan, 2026-08-10).

⚠⚠ **Worse than noise:** pressing **Apply all** on those resurrected lots writes the older pipeline text back over the newer catalogue text — silent loss of human edits.

## Measured on the live DB, 2026-08-10 (read-only, before the fix)

\`appliedDesc\` was written by **\`acceptKP\` only** (the manual apply), never by the Batch/KP auto-apply path:

| run | lots | appliedDesc persisted | DC issues | would need review on a fresh load |
|---|---|---|---|---|
| F103 | 601 | 239 (= exactly its DC-issue count) | 239 | **362 — none of them DC** |
| F106 | 377 | 7 | 112 | **365 (260 non-DC)** |
| F104 | 448 | 335 | 323 | 113 |
| F096 | 542 | 540 (Apply all pressed 10 Aug) | 105 | 0 |

The non-DC lots demanding a manual apply all had \`dcStatus='ok'\`, \`kpStatus='ok'\`, \`appliedDesc IS NULL\`, and a catalogue description **systematically longer** than the pipeline's stored text (145 vs 187, 66 vs 108, 116 vs 148…) — the catalogue had moved on after the pipeline wrote it, exactly the fallback failure above.

## Fixed 2026-08-10

- **Batch stage**: applies *first*, records \`appliedDesc\` only when the write succeeded, and persists it in \`saveLot\`. It previously set \`appliedDesc\` optimistically in the same state update as the result — **before** the \`applyAiDescriptionOne\` call and regardless of whether it threw — so a failed apply looked applied for the rest of the session.
- **Key Points stage**: \`applied\` hoisted so \`saveLot\` persists \`appliedDesc\` (its own write, or the value Batch already put on the lot).
- Stage log numbering corrected — Double Check and Key Points **both** announced "Stage 2", which makes the run log useless for diagnosing exactly this.

## Double Check now auto-applies too (2026-08-10, same session)

Told that DC held every \`issues\` lot by design — a large share (F104 323/448, F103 239/601) — Jordan reversed it: **"It may sound stupid but I just want auto apply to mean auto apply."** So \`runDoubleCheckStage\`'s \`issues\` branch now applies \`revised\` when \`autoApply\` is on, sets \`currentDesc\`/\`appliedDesc\`, and persists \`description\` + \`appliedDesc\`; the log reads "DC cleaned up & applied" vs "held for review". The on-page help text and the ⚡ Auto-apply tooltip were rewritten to match — **keep all three in step if this ever changes again.**

## 🖼 Resuming the lots that missed the run (2026-08-10)

Jordan's real workflow: ~500 lots, ~10 with no photos yet, run the 490, photograph the rest, come back. **That comeback was a dead end** — once \`PipelineRun.stage\` is \`complete\`, all three stage guards in \`handleRun\` are false, so pressing Start does *nothing*. There were banner buttons to re-run Key Points and Double Check but **none for Batch**, so the only routes were ↻ on each lot one at a time, or Reset Progress, which deletes the whole run's results for all 500.

Fix (he asked for exactly this: "detects those 10 didnt get ran last time and lets me resume just those 10"): a **🖼 banner + "↻ Resume these N"** button in the \`stage === "complete"\` block, beside the existing two.
- **\`notRunYet(l) = l.imageUrls.length > 0 && !l.currentDesc?.trim()\`** — has photos now, never got a description. ⚠ Keyed on the description, **not \`batchSkipReason\`** — that reason is state-only (\`saveLot\` persists just \`batchStatus: "skipped"\`), so after a reload nothing records *why* a lot was skipped.
- **\`resumeNotRun()\`** clears those lots' \`batchStatus\`/\`kpStatus\`/\`dcStatus\` (state + DB) then calls \`runBatchStage\` → \`runKPStage\` → \`runDoubleCheckStage\` **directly**. ⚠ It deliberately does NOT rewind \`stage\` and lean on Start — \`setStage\` is async, so \`handleRun\` would still read the old value. Same trick \`rerunLot\` already uses. Every other lot keeps its status, so all three stage filters skip it and only the stragglers run.
- Known and accepted: a lot that keeps getting **content-blocked** has photos and no description, so it sits in this banner permanently and re-fails on each press — same as ↻ on a single lot.

## Still open — not changed without asking

- **Existing runs are not repaired.** The fix only covers runs from here; F103/F106 etc. still have null \`appliedDesc\` and will still show a large Review & Apply list. A one-off backfill (mark applied where the pipeline text already matches the catalogue) was offered and **not built — awaiting Jordan's word.**
- \`POST /api/auction-ai/pipeline/lot\` spreads arbitrary client-supplied fields straight into \`prisma.pipelineLot.upsert\` (mass assignment). Session-gated and the model is innocuous, so a smell rather than a live hole.

## ⚠⚠ 2026-08-19 — A FINISHED SALE COULD NOT BE RE-RUN: THE RESET BUTTON HID ITSELF

Jordan, on F109: "I cant mark runs as uncomplete anyway so I can reset the progress so like the run pictured I cant start it again if I want to run it again". The screen showed "Pipeline complete — all descriptions applied for F109" and the log line "Loaded saved pipeline — stage: complete · 0 lots (1 without photos, 463 already described hidden)".

A ↺ Reset Progress button ALREADY EXISTED, with DELETE /api/auction-ai/pipeline behind it — but it was rendered under \`lots.length > 0 && !running\`. A finished sale loads ZERO lots, because "Skip lots that already have a description" hides every described lot. So THE ONE CONTROL THAT LETS YOU START OVER DISAPPEARED EXACTLY WHEN IT WAS NEEDED. A catch-22, not a missing feature.

Two fixes: (1) a \`hasSavedRun\` state set from pipeData.run on load, with the button gated on \`(lots.length > 0 || hasSavedRun)\` — ⚠ never re-gate this on lots.length alone, that IS the bug; (2) a zero-lot load now EXPLAINS ITSELF (RULES.md design rule 7 — never let "nothing happened" look like success), because it previously just went blank and a finished sale looked identical to one that failed to load. The panel names the numbers (total / already described / no photos), says which toggle hid them, and spells out the ORDER.

⚠ THAT ORDER IS THE NON-OBVIOUS HALF. Unticking the skip toggle alone is NOT enough: handleLoad maps the saved PipelineLot statuses back onto the lots and runBatchStage filters on \`!l.batchStatus\`, so every lot arrives already carrying batchStatus "ok" and the run does nothing. BOTH steps are needed — reset AND untick — which is why the panel says so rather than leaving it to be discovered. Reset also clears hasSavedRun and its log line now names the next step.
`,
  },
  {
    filename: "hub_workflow.md",
    content: `---
name: Hub workflow — how Vectis actually uses it, end to end
purpose: The real-world lot lifecycle (goods in → cataloguing → overnight BC import → 🔗 BC Match links the IDs → Push to BC enrichment → sale). Explains WHY unique IDs don't match mid-flow. Read before interpreting any Hub↔BC mismatch as an error.
last_updated: 2026-08-05
---

# The lot lifecycle — how the Hub is actually used (from Jordan, 2026-08-05)

Confirmed with Jordan in conversation. The key insight that prompted it: unique-ID mismatches were flagged as "genuine mistakes to fix" and he corrected it — **unique IDs are NOT expected to match until the lots have been created in BC and linked back**. Features must understand the lifecycle stage a lot is in, not flag normal mid-flow states as errors.

## The flow

1. **Goods in** — booked into BC as a receipt, physically sorted into totes (P/T numbers). The Hub syncs BC's tote + item data (BC Warehouse → Data Sync).
2. **Cataloguing** — iPads, lot wizard: scan/type the tote → vendor + receipt pulled from BC tote data; photos; key points; F-number barcode label on the item. ⚠ **Since 2026-08-06 the Hub mints NO unique ID at all** — \`receiptUniqueId\` stays NULL until step 5 (the old provisional advisory-lock minting was removed on Jordan's instruction; BC's numbering is the single source). The BARCODE is the lot's only identifier until then.
3. **AI descriptions** — Batch Run / Auto Pipeline (photos + key points → description + estimate).
4. **Into BC (overnight)** — the hotkey macro works through the tote/barcode sheet (now generated by **End of Day → BC**) and creates the receipt lines in BC. **BC assigns each line its OWN UniqueID at this point.**
5. **Linking back — 🔗 BC Match**: upload the BC **Lines export**; it matches rows to Hub lots **by barcode**, compares receipts, and where the receipt agrees imports **BC's UniqueID onto the Hub lot** (\`bulkAssignUniqueIds\`). Two doors to the same engine: the per-sale "BC Match & Import" modal (Auction Manager sale page, \`auction-tabs.tsx\`) and, since 2026-08-06, the **all-sales version on End of Day → BC** (\`matchBcLinesAcrossAuctions\` — the macro puts every Hub sale's lots into ONE BC sale, so the export spans several Hub sales). From here the Hub's \`receiptUniqueId\` = BC's — the provisional Hub ID is replaced.
   ⚠ **DUPLICATE BARCODES USED TO LOSE A LOT SILENTLY (fixed 2026-08-14).** Jordan on F109: "there is 595 lots yet its only doing something with 594 its missing one". The panel read 594 BC rows · 595 our lots with 590 match + 4 mismatch + 0 + 0 — every count reconciling to 594 and nothing flagged. Cause: \`BCMatchModal\` built \`barcodeMap\` as \`Map<string, Lot>\`, so when two of our lots carried the same barcode the second OVERWROTE the first; BC's single row matched whichever won, and the loser appeared in NO category at all — not among the BC rows, and not in "in our system but not in BC" either, because its barcode IS in the file. Reproduced exactly (590/4/0/0) with a harness before anything was changed. Fix: the map is now \`Map<string, Lot[]>\`; a barcode on two lots becomes its own status **duplicate**, both lots are listed and NEITHER is imported, because guessing would write BC's UniqueID onto the wrong lot — precisely what the barcode-only rule exists to prevent. Two honesty guards came with it: lots with NO barcode are stated up front (they could never be matched and were invisible), and the panel now checks its own arithmetic and says so in amber when the buckets don't add up to the lot count. ⚠ Do NOT simplify the map back to one lot per barcode — there is no DB unique constraint on \`barcode\`, so duplicates are always possible.
   ⚠⚠ **THE DUPLICATE CHECKER OFFERED TO DELETE A REAL LOT (fixed 2026-08-14, same F109 investigation).** It grouped ONLY by \`receiptUniqueId\` and offered to delete the lower-scoring lot — but F109630 and F109631 are two DIFFERENT Steiff bears with DIFFERENT barcodes that had both ended up on R008767-129. Pressing Delete, or "Delete All", would have destroyed a genuine lot. Sharing a unique ID does NOT make two lots the same item: the Hub no longer mints IDs, BC supplies them, so a clash means bad data rather than a double entry — THE BARCODE IS THE IDENTITY. The modal now separates three things: GENUINE DUPLICATES (same unique ID and the barcodes agree, or at most one lot has a barcode) which alone are deletable and are all that Delete All covers; CLASHING UNIQUE IDS (same ID, different barcodes) listed and explained with NO delete button; and CLASHING BARCODES (one barcode on two lots), also read-only, which is the diagnostic for the BC Match shortfall above. ⚠ Never make the checker delete on unique ID alone again, and do not add a delete button to either clash list — which lot is wrong is a judgement about the physical items, not something to guess.
6. **Enriching BC** — 📤 Push to BC tab fills the BC sheet's Short Description / estimates / Size Classification / categories **matched by UniqueID** (which now works, because of step 5), pasted back into BC.
7. **Sale prep onwards** — lotting up, review, photography → auction (Auction Controller / Auto Clerk) → packing/dispatch (Royal Mail).

## ⚠ What this means for features

- **\`receiptUniqueId\` is NULL before step 5, authoritative after** (2026-08-06 — the provisional Hub minting is gone). A Hub↔BC unique-ID comparison is only meaningful AFTER 🔗 BC Match has run. Barcode is the stable identifier through the whole life (which is why Admin Centre, End of Day and BC Import Check all match on barcode) — a lot with no barcode now has no identifier at all until BC Match, so barcodes matter more than ever at cataloguing time.
- A \`unique_id_mismatch\` (uid prefix vs lot receipt) mid-flow usually means the receipt was corrected after minting — harmless, self-corrects at step 5. The End of Day check hint was reworded to say so (amber, not red).
- The reconciliation tools map to the steps: **End of Day → BC** feeds step 4; **BC Import Check** repairs a broken step 4; **🔗 BC Match** is step 5; **BC Check tab** verifies step 6 landed; **Tote Check / BC Corrections** police step 2's data quality.

⚠⚠ 2026-08-20 — BC CORRECTIONS IS LIVE-ONLY. Jordan: "All BC corrections should do is give me a quick way to fix the things found in the tote check." It is a JOB LIST for Tote Check's findings, not a record of its own. It read "97 to correct in BC" on F109 while Locking Check said 591/595 and Tote Check said "4 to look at" — because the route merged live mismatches WITH saved CatalogueBcCorrection rows written by Match BC (4 live + ~93 saved). A saved row now contributes its TICK and nothing else, and live values win over saved ones which may be stale. ⚠ THE TRADE, chosen knowingly: a lot whose Hub value has already been corrected no longer appears, even if BC still holds the old value — both lists now follow ONE source of truth, the BC tote data, so a row clears when BC is corrected and Data Sync runs, not when the Hub is tidied. Do not reinstate the merge. Also fixed: the group header coloured ALL old values red and ALL new green regardless of what changed, so an unchanged vendor read as work to do.

## What the Hub does NOT cover (confirmed 2026-08-05)

**All invoicing and customer accounts are handled by BC and the website provider** (the live-auction platform). The Hub never touches money or customer billing — don't build features that assume it does.

## Timing (confirmed 2026-08-05)

- **🔗 BC Match runs right after each overnight macro run** — lots are macro'd into BC, then matched, so the IDs link up batch by batch.
- **📤 Push to BC runs once at the END, after all AI pipelines have finished** — descriptions/estimates go across when they're final, not incrementally.
`,
  },
  {
    filename: "end_of_day_bc.md",
    content: `---
name: End of Day → BC (/tools/cataloguing/end-of-day)
purpose: One-click end-of-day hotkey sheet — every Hub lot not yet in BC, grouped by tote, in the exact ToteNumber/LotCount/Barcodes format the overnight macro runs. Read before touching it or the BC import flow.
last_updated: 2026-08-05
---

# End of Day → BC — /tools/cataloguing/end-of-day (built 2026-08-05)

At the end of each day, generate the sheet the overnight "add to BC" run works through, instead of compiling it by hand. Decisions: **the runner is the existing hotkey macro** (not BC's own per-receipt Import Template — though that exists, see below), scope is **everything not yet in BC** (not "today only" — stragglers get swept up), and it lives as **its own Cataloguing page**.

## How it works

- **API \`GET /api/catalogue/end-of-day\`** (CATALOGUING app access): all \`CatalogueLot\`s in **non-complete sales** (\`?includeComplete=1\` widens), checked against the synced \`WarehouseItem\` data, case-insensitive via the variants trick (Prisma \`in\` is case-sensitive). ⚠ Deliberately NOT \`CatalogueLot.addedToBC\` — same reasoning (and same measurement) as the Admin Centre. ⚠⚠ **In-BC = BARCODE ONLY (Jordan's explicit rule, 2026-08-07: "unique ids shouldn't be used for any sort of matching")** — the uniqueId fallback was removed entirely, not just narrowed. It used to be an OR across both fields, and **legacy Hub-minted provisional IDs ({receipt}-N, pre-2026-08-06) collide with BC's own numbering for OTHER items** (F121276 carried R009332-1 = BC's F114104), so **292 pending lots across 10 sales were silently counted "already in BC" and kept off the sheet** (F121 read 132 of 184). Never re-add any uniqueId matching here (rule also in RULES.md Lot Identifiers); the stale minted uids stay on the lots until 🔗 BC Match overwrites them. A barcode-less lot lands in the no-barcode problem panel regardless.
- **Output = \`BC_Import.csv\`, RECEIPT-keyed (corrected 2026-08-07)**: CSV \`ReceiptNumber,LotCount,Barcodes\` (pipe-separated), CRLF, **one row per receipt** (a receipt spanning several totes = ONE row, barcodes deduped within it), receipts sorted numerically. ⚠⚠ Jordan 2026-08-07: **the macro works receipt-by-receipt in BC and looks for the exact filename \`BC_Import.csv\`** — the original tote grouping + dated filename were WRONG (inherited from the old Import Check sheets). \`parseHotkeySheet\` accepts both vintages; \`buildHotkeyCsv\` emits the receipt header; every download (End of Day sheet + both Import Check re-run sheets) is named \`BC_Import.csv\`.
- **Nothing is silently dropped**: lots with **no receipt** or **no barcode** can't go on the sheet — red/amber problem panels (tick + apply to fix). **A missing TOTE no longer blocks the sheet** — \`no_tote\` is a regular amber check ("still on the sheet, can't be verified against the BC tote data"). \`duplicate_barcode\` = same barcode under two RECEIPTS (still the only check that pulls lots off, visibly). no_tote/no_receipt/duplicate_barcode are never ignorable. Per-sale chips show where lots come from; a completed sale contributing lots shows amber.
- Page notes: run BC Warehouse **Data Sync** first or already-imported lots reappear (the check is against the sync cache); reconcile breakages in **Auction AI → BC Import Check**.

## Checks (added same day)

Every lot on the sheet is verified before it's trusted overnight — **shared \`lib/tote-check.ts\` \`checkLot()\`**, the same engine as the Tote Check tab, so the two can never disagree. Plus three sheet-specific checks:
- **\`duplicate_barcode\`** — same barcode under two totes. ⚠ The ONLY check that pulls lots OFF the sheet (importing under the wrong tote puts the BC line on the wrong receipt) — shown in a red panel, never silent.
- **\`receipt_not_in_bc\`** — the lot's receipt exists in neither \`WarehouseTote.receiptNo\` nor \`WarehouseItem.receiptNo\` (variants trick both). Flagged, stays on the sheet.
- **\`invalid_barcode\`** — fails the RULES.md format regexes after non-ASCII strip. Flagged, stays on the sheet.

Everything else (tote_unknown / receipt_mismatch / vendor_mismatch / unique_id_mismatch / receipt_missing / vendor_missing) is **amber report-only** — checks never write, and the tote-sync time is shown so a stale sync reads as "sync first", not "93 mistakes". \`CHECK_META\` on the page reuses the Tote Check tab's wording.

**Check rows redesigned 2026-08-06** (Jordan: the old flat rows showed "BC vendor C225880" without showing what the LOT said, so a mismatch looked like agreement). Every row is now a plain-words comparison built by \`IssueLine\` (per check key) from coloured \`Chip\`s: **red = the wrong value on the lot**, "should be", **green = what BC says**, grey = context. The API resolves **vendor NAMES for both sides** (\`vendorName\`/\`bcVendorName\` — tote side from \`BcTote.vendorName\`, lot side + gaps from a distinct \`WarehouseItem\` lookup) so nobody decodes C-numbers. Rows are bordered label-blocks (whole row clicks the tickbox), sale + cataloguer right-aligned. Keep new check types readable by adding a case to \`IssueLine\`, not by reverting to flat fact rows.

**🔧 "Fix what BC can prove"** (added 2026-08-05): \`autocorrectLotsForAuctions(ids, apply)\` in \`lib/actions/catalogue.ts\` — ⚠ deliberately a LOOP over the existing per-sale \`autocorrectLotsFromTotes\`, ONE fix choke-point, so this button, Tote Check → Match BC and the checks (shared lib/tote-check.ts) can never disagree. Fixes receipt/vendor from a KNOWN BC tote only; unknown totes are never guessed; wrong values that already went to BC land on the BC Corrections list; all logged (\`tote_autocorrect\` + batchId); BC-locked sales fail their own call for non-admins and are reported as skipped while the rest proceed. **Preview-first since 2026-08-06**: the button runs \`apply=false\` — the same choke-point computes and returns \`changes: AutocorrectChange[]\` (barcode, sale, tote, old→new vendor incl. name, old→new receipt) without writing, shown in a modal (red = current, green = BC); Apply re-runs with \`apply=true\`. The old confirm() dialog is gone; keep preview and apply on the one code path.

**🔕 Ignore a warning** (added 2026-08-06, for flags that are wrong because the sync is behind): per lot + check type in the new **\`EodCheckDismissal\`** table (\`@@unique([lotId, checkKey])\`, migration in the MIGRATIONS array). Actions \`dismissEodChecks\` / \`restoreEodChecks\` (max 400 pairs, requireCataloguer). The API files dismissed rows under \`ignored\` per check (migration-safe — table missing = nothing ignored); panel header shows "· N ignored", collapsible list with Restore / Restore all. ⚠ **\`duplicate_barcode\` is never ignorable** (it changes what goes on the sheet) — enforced in the action AND the API split; \`no_tote\` gets no ignore link either (blocker, not warning). Report-only — nothing on the lot changes.

Measured on production 2026-08-05: **5 unique_id_mismatch, 93 tote_unknown, 64 receipt_not_in_bc, 0 duplicates** — it catches real issues on day one.

⚠⚠ **Those 64 receipt_not_in_bc (and most tote ambers) were FALSE POSITIVES — root-caused and fixed 2026-08-06.** The check reads \`WarehouseTote.receiptNo\`, but that column was only written by \`sync/totes-active\` from \`Receipt_Totes_Excel\`, and **BC drops a tote from that feed the moment it's ticked Catalogued** — so any tote catalogued before its enrichment was captured sat as a bare shell (receiptNo null) and its perfectly-real receipt looked "not in BC" (proven with BC's own Receipt Totes page: T024560 → R008385 ✓). Fix = **\`sync/totes-all\`** (Data Sync stage 6 "All Receipt Totes" + nightly cron) walking the **eva/tot custom API** — the full 20,561-row receipt-tote table, catalogued included (page 76804 \`EVA_TOT_ReceiptToteAPI\`, company addressed by GUID, camelCase fields, helper \`bcTotApiUrl\` in lib/bc.ts). One Data Sync run after deploy populates the shells and the count collapses to genuine issues. **Never "fix" this check by loosening the comparison — fix the sync coverage.**

## Manual intervention — tick lots, move them (added 2026-08-05)

Every check panel (and the no-tote list, now the same panel type) has **tickboxes + "Tick all"**; ticking anything floats a **fixed bottom bar**: type a tote or receipt → **Check in BC** (\`lookupToteOrReceipt\` — the same verify-first flow as Manage Lots → Change Vendor; a number not in the BC data can't be applied) → confirmation line states what it belongs to → **Apply to ticked lots**.

- Apply = **\`setLotsVendorReceiptAcrossAuctions\`** → groups the selection by sale and loops the existing **\`setLotsVendorReceipt\`**, which gained an optional **\`tote\`** param (set only when the lookup was a tote; Manage Lots doesn't pass it — unchanged there). So: tote entered → tote + receipt + vendor all corrected; receipt entered → receipt + vendor only, totes left alone.
- Same guarantees as Manage Lots: logged (\`vendor_change\` + batchId), **per-sale Undo** via CatalogueBulkUndo, existing unique IDs preserved (minted only for blanks), BC-locked sales skip for non-admins and are reported. Selection is cleared on every data refresh so stale lot ids can't be applied.
- This is the fix for the **tote_unknown** pile the auto-fix can't touch: tick the batch with the mistyped tote, type the right one, apply.

**📝 Mass re-map (typed, added 2026-08-05)** — collapsible panel above the intervention bar. Textarea, one change per line \`wrong → right\` (also accepts \`->\`, comma, tab, spaces). **Preview is mandatory before Apply** (button disabled until previewed): each line shows what the right side resolves to in BC and how many pending lots the left side hits — per-line red/grey/green results. \`massRemapPendingLots(lines, apply)\` in catalogue.ts (max 100 lines): LEFT matches tote OR receipt on **not-yet-in-BC lots in non-complete sales only** (in-BC wrongness belongs to BC Corrections, not a Hub remap); RIGHT must resolve via \`lookupToteOrReceipt\`; apply loops the same \`setLotsVendorReceiptAcrossAuctions\` (all the usual guarantees). Lines run in order, so a later line sees an earlier one's changes.

## 🌅 The morning after (added 2026-08-06 — the macro runs everything into ONE BC sale overnight)

Two collapsible panels at the bottom of the page, plus a refresh-behaviour change:

- **🩹 Import Check** — the SAME engine as Auction AI → BC Import Check, extracted to **\`lib/bc-import-sheets.ts\`** (readSheet/parseHotkeySheet/parseBcLinesExport/reconcileImport/buildHotkeyCsv — ⚠ ONE copy, both UIs import it; the Auction AI tab kept its dark styling, the End of Day panel is dual-theme). Extra convenience: "📄 Use tonight's sheet shown above" feeds \`data.totes\` as the hotkey side (tooltip warns: if a Data Sync ran since, upload the file that actually ran).
- **🔗 BC Match (all sales)** — the BC Lines export spans several Hub sales, so the per-sale AM modal can't take it. Action **\`matchBcLinesAcrossAuctions(rows, apply)\`**: client parses via \`parseBcLinesForMatch\` (Internal Barcode / Receipt No. / UniqueID), server matches by barcode across every NON-complete sale, **same rule as the AM modal: only a row whose receipt AGREES imports**; apply groups by auction and loops the per-sale **\`bulkAssignUniqueIds\`** (the ONE UniqueID-import choke-point — never import IDs any other way). Cap 10,000 rows; display lists capped (1,000 / 500), counts are the truth. Filter tiles: Ready to import / Receipt disagrees / Not in the Hub / **Didn't come back** (pending lots the export doesn't cover). BC-locked sales fail their own call and are counted.
- **⚠ NO auto-refresh (Jordan's explicit call)** — after any apply/import/remap the page does NOT reload; it sets \`stale\`: amber banner + the ⟳ Refresh button turns amber/pulses. The heavy check suite re-runs only on the button. **Exception:** Ignore/Restore move rows locally (\`moveIgnored\`) — instant. Don't re-add auto \`load()\` calls after actions.
- **Refresh feedback (2026-08-07)** — button shows "⟳ Pulling the lots in…" while loading, flashes green "✓ Refreshed" 2.5s; live readout underneath: "📥 Lots last pulled: 16:42 · 5m ago" (\`generatedAt\` via \`fmtPulled\`) + "🔄 BC data last synced" (\`toteLastSync\`), re-rendered each minute by an age tick.

## Registration

Sidebar \`components/cataloguing-sidebar.tsx\` + \`APP_SECTIONS.CATALOGUING\` key **END_OF_DAY** ("End of Day → BC", 🌙). ⚠ Users with configured sidebar sections won't see it until an admin ticks it (the Photography lesson).

## Measured on production 2026-08-05 (read-only)

3,754 lots in active sales → 2,302 already in BC → **1,452 pending across 94 totes**; zero missing barcodes/totes. ⚠ The FIRST sheet is the whole backlog; after one overnight run it becomes each day's lots.

## The macro itself — AutoHotkey v2 on Jordan's PC (v5, 2026-08-07)

"Make BC Lots from Receipt Number.ahk" — AutoHotkey v2, drives the **BC Cataloguing page in Chrome by fixed screen coordinates**, reads \`bc_import.csv\` (= the End of Day BC_Import.csv) from the script's folder. Per receipt: type receipt → Enter → per barcode: Create Line → barcode → close/save → confirm. BC must be **pre-positioned on the Cataloguing page** before F9. **v3→v5 rework (2026-08-07, written by Claude, lives on Jordan's PC not in git)** fixed the misclicks-when-BC-is-slow problem. Hard-won lessons baked into v5:

- ⚠ **"Screen settled" is ALSO true right after a click, before BC starts loading** — v3 typed early on slow card-opens (whole-page Ctrl+A highlight, barcodes into the wrong place). Every wait is **CHANGE-then-settle**: fingerprint the target area, require it to visibly CHANGE (card/popup actually appeared), then hold still.
- **Look-before-typing** (\`SafeType\`): after clicking a field, select+copy+inspect first — a page-sized clipboard blob = not in the field → back off and re-click. Type only into a small verified field; copy-back compare after. Receipt verified BEFORE Enter (a missed receipt used to dump the whole batch onto the PREVIOUS receipt).
- **The close-confirm popup lags** — clicking its coordinates blind navigated BC to a different page (Jordan hit this live). v5's \`CloseCard\` requires PROOF: the popup's spot must visibly change before Yes is clicked; no popup after 3 Close attempts = lot logged UNCONFIRMED.
- **Circuit breaker**: 3 consecutive failures = assume the script is lost on a wrong page → STOP with instructions, never churn unattended. Resume via \`bc_import_progress.log\` (⚠ clear it before a NEW sheet); failures logged to \`bc_import_failures.log\` for Import Check to sweep; F10 pause.
- **AutoHotkey v2 is installed on Jordan's PC** — ALWAYS validate a script before handing it over (\`AutoHotkey64.exe /ErrorStdOut /Validate\` via PowerShell Start-Process with redirect+wait; git-bash mangles /switches into paths), and deliver by writing the file to his Downloads — chat copy-paste lost 14 lines once ("Missing }").

⚠ Jordan declined the watchdog/PC-companion idea ("doesn't really do what I need") — don't re-pitch monitoring unprompted.

## 🎯 Macro Calibrator — new-machine coordinate setup (2026-08-20)

"Macro Calibrator.ahk" (Jordan's Downloads, not in git) removes the pain of hand-editing coordinates on a new machine. Run it → pick ANY of the coordinate macros (BC import, tote, Description Copier…) → it parses every fixed screen position in the file — both styles: named pairs (\`RECEIPT_X := 603\`) and inline \`MouseMove/Click x, y\`, with labels read from the macro's own comments — then walks through them one at a time: a big banner across the top of the screen names the button (hopping to the bottom if the mouse comes near it), hover the mouse over the real button and press **F8** to capture (F10 keeps the old position, F7 goes back, Esc stops without changing anything). After a review of old → new, it rewrites the macro in place, keeping a dated backup next to it, and syntax-checks the result with AutoHotkey itself — a failed check restores the backup automatically. Warns if a macro never sets CoordMode Screen. Verified against v5 (5 named pairs), the tote macro (6 inline pairs, negative second-monitor coordinates included) and the Description Copier macro. ⚠ Coordinate changes go through the calibrator — never hand-edited numbers in chat. ⚠ Three launch lessons baked in: capture keys must be REAL registered hotkeys (a background script's polled key state never updates, so F8 silently did nothing); identical coordinates are NEVER grouped into one point — the Description Copier has four different buttons all at placeholder 0, 0, each its own line-targeted replacement; and laptop F-row keys are often manufacturer keys (Jordan's laptop popped a blank "support" window on every F8), so **middle-click also captures** and an error handler writes any real fault to "Macro Calibrator errors.log" beside the script. Get the file onto other machines via the Macro Downloader tab, never chat copy-paste. Confirmed working by Jordan on both his PC and the new laptop (middle-click) on 2026-08-20.

## ⚠ Layout — two scrollbars + white space (root-caused in the browser 2026-08-10)

Jordan: "a bug in the formatting here with the multiple sliders and white space" — a second window scrollbar plus a near-white band under the app, once **both morning-after panels are expanded**.

**Root cause: Tailwind's \`sr-only\` is \`position:absolute\`, and nothing in the chain was positioned.** The hidden file inputs inside the drag-and-drop upload labels resolved against the **initial containing block (the document)** rather than the scroller, so \`.content\`'s \`overflow-y-auto\` never clipped them and their static position (wherever the scrolled content put them, y≈1133) extended the **document's** scroll height. The window grew its own scrollbar beside the content one, and scrolling it exposed \`body\`'s \`bg-gray-50\` below the 100vh app root — the "white space". Measured live on staging: document **1134px → 855px** in an 855px viewport from \`position:relative\` alone, with the content column still scrolling normally (1186 > 807).

Fix = **\`relative\` on the shell's content column** (\`components/cataloguing-shell.tsx\` — covers every cataloguing page) **plus \`relative\` at source on every label wrapping an \`sr-only\` input**: end-of-day's \`drop\` constant + its BC Match label, \`auction-ai/bc-import-check-tab.tsx\`'s \`drop\`, and \`auctions/[id]/bc-check-tab.tsx\`. Those are the only three files in the app containing \`className="sr-only"\`. ⚠ **Any new upload zone needs \`relative\` on its wrapper** or this returns.

⚠⚠ **The first attempt was a WRONG diagnosis, recorded here so it isn't repeated:** nested scroll containers (the shell's \`overflow-y-auto\` inside the app layout's \`overflow-auto\` \`<main>\`) were blamed and \`overflow-hidden\` was shipped on the shell. Measurement disproved it — \`main\` never scrolled in either axis — and that change was reverted. The nesting is real but harmless, and the shell's own scroller is what pins the sidebar, so don't "simplify" it away.

Same report: the **Import Check** drop-zone grid is \`grid sm:grid-cols-2\` with a button under the LEFT drop zone only, so the stretched right \`<label>\` came out taller than the left with its contents out of line — \`items-start\` on the grid.

## 📄 Catch-up sheet — PER SALE, upload-driven (2026-08-10)

⚠ **This one is NOT on the End of Day page — it is a tab on the SALE** (/tools/cataloguing/auctions/[id] → **📄 Catch-up sheet**, between BC Check and Push to BC). Jordan chose that placement when asked; he is already inside the sale.

Jordan's case: a sale goes into BC **in stages** over several days ("my last lego sale needs the lots in now and I have already partially uploaded them via the end of day"). Neither existing tool covers it — the **End of Day sheet** derives "already in BC" from the *synced* cache and spans every non-complete sale (no per-sale option), and **Import Check** needs the original hotkey sheet that ran, which does not exist for a staggered sale.

\`catchup-sheet-tab.tsx\`: upload the **BC export** → get a fresh \`BC_Import.csv\` of everything in THIS sale that is not in it.
- ⚠⚠ **The uploaded export is the ONLY source of truth for "what's in BC" — the sync is not consulted at all.** That is the entire point: it is correct mid-sale when the sync is behind, which is exactly the trap the main sheet has.
- ⚠ **Barcode-only matching** (RULES.md) — never \`receiptUniqueId\`.
- **Entirely client-side**: the sale page's \`lots\` already carry \`barcode\` + \`receipt\`, so there is **no API route, no server action and no migration**. Reuses \`lib/bc-import-sheets.ts\` (readSheet / parseBcLinesExport / buildHotkeyCsv / normSheetVal) so the CSV cannot drift from the End of Day one.
- Mirrors the End of Day sheet exactly: one row per receipt, barcodes deduped within a receipt, receipts sorted localeCompare(…, "en-GB", {numeric:true}), filename always \`BC_Import.csv\`.
- **Cross-receipt duplicate barcodes are held back**, visibly, same rule and same reason as End of Day. Lots with no barcode / no receipt get their own panels — nothing is silently dropped.
- Export rows **not** in this sale are counted and stated as **normal, never flagged** — the overnight macro puts several Hub sales into one BC sale, so an export legitimately spans them. Do not "fix" that into a warning.
- BC's own \`Errors\` column from the export is surfaced (rows BC took but disliked).

## For later — BC's own receipt import exists

\`EVA_ReceiptImportManagement\` (Evo-auction Base, codeunit 75725): Excel import **per receipt header**, column mapping defined by per-vendor \`EVA_ReceiptImportTemplateMap\` (headers matched by NAME in row 1; every sheet in the workbook imports into the ONE receipt you ran it from). If the overnight process ever moves off the macro onto this, the export must become one file per receipt and match the template's exact header names. The TRUE endgame for macro pain is a small BC-side AL extension creating lines server-side from the whole sheet — model it on this codeunit. Read the codeunit before building that.
`,
  },
  {
    filename: "auto_clerk_review.md",
    content: `---
name: Auto Clerk — 2026-08-04 review fixes
purpose: The full-review fixes to the Scenario 1 rig, shadow pages, gap-relay and the reference card — including the undo-rule card update. Read WITH the reference card before touching auto-clerk code.
last_updated: 2026-08-04
---

# Auto Clerk — review fixes (2026-08-04)

A full review of /tools/auto-clerk; these fixes shipped to staging. The reference card on the launcher remains the source of truth — it was **updated** as part of this (see Undo below).

## Scenario 1 rig (public/auto-clerk-fake-saleroom.html)

- **\`act('undo')\` now rolls back \`S.hi\` too** (was only \`S.bid\`). \`readSaleroomBid()\` reads \`S.hi\`, so the stale high made undo-then-rebid-at-the-same-amount a no-op — the re-bid never registered on Saleroom.
- **\`syncSaleroomDownToTarget()\`** — downward twin of \`syncSaleroomToTarget\`: one Vectis retraction can drop more than one step, and one Undo click removes one row. Verify-and-retry, then the red banner. ⚠ The 2s watchdog is deliberately still **upward-only**: "Saleroom ahead" is a legitimate state (an independent saleroom.com bidder can lead until Vectis catches up) — do NOT make the watchdog auto-undo.
- **\`onlineBidAt(amount)\`** — on an automatic (allowlist) bid the REPLICA now simulates the online bid arriving at the exact amount. ⚠ Deliberately NOT an \`autoClick\` — it stands in for saleroom.com's own feed, which the real page shows by itself. Before this, the watchdog "corrected" the invisible gap 2s later by pressing Bid, logging phantom **ROOM** bids for online bidders.
- **Digit-typing guard**: the type-a-digit→bid-box shortcut now skips when focus is in ANY input/textarea/contentEditable (typing into Find lot / chat / H was being hijacked).
- **\`hiRow(v)\`** highlights the increment row at exactly v; \`setLiveAskingPrice\` uses it (the old \`hiInc(asking-1)\` targeted a row that never exists, e.g. £109 for asking £100).
- FW toggle only posts the red chat line when turning ON; the stale "Sell then Next 2.2s later" comment corrected (Next fires on \`activeLotChange\`); dead \`RECOGNISED\` set removed.

## Reference card — Undo rule changed (approved)

Rule 6 now reads: **auto-detected in Scenario 1, manual everywhere else** — the Scenario 1 auto-clerk clicks Undo when the Vectis amount drops below the last seen, until matched; shadow views never detect undos; clerk mistakes stay manual. The don't-exist list matches. Don't "restore" the old "undo is manual only" wording — code and card now agree. The legacy coordinator's 10s constants are commented as sped-up sim timings (real rule: 15s → FW, 20s → Sell).

## gap-relay classification order

\`classify()\` now checks **terminal states before bid substrings**: fair warning → unsold/passed → sold → offered → internet bid → room bid → paused → resumed. "**Sold to internet bidder**" previously hit \`'internet bid'\` first and the HAMMER prompt never fired. ⚠ Still validate against a real captured GAP session — actual message texts are unconfirmed.

## Shadow pages

- auto-clerk-live: unreachable duplicate \`lotInformationUpdate\` branch removed; **Production/Staging WS preset dropdown** added (was hardcoded to production), persisted per machine.
- auto-clerk-saleroom: unused import + dead \`lastSeen\` state removed.
`,
  },
  {
    filename: "ai_cost.md",
    content: `---
name: AI cost — prompt caching + run price estimator
purpose: Claude prompt caching in lib/ai-provider.ts (cachePrefix) and the "estimated cost" panel before Auction AI runs, priced from lib/ai-pricing.ts + the admin-editable AiModelRate table.
last_updated: 2026-08-04
---

⚠⚠ 2026-08-20 - THE REAL LIMIT IS 4 REQUESTS PER MINUTE, PER MODEL. Every model in the Model Tester returned 429 at once, including Lyria which cataloguing never calls - when EVERY model refuses on one GEMINI_API_KEY the limit is at PROJECT level, not per model and not caused by how fast a tool is calling. Google Cloud > Quotas, project auction-ai: "Request limit per model per minute for a project in the paid tier 1" = 4 for gemini-omni-flash (20 for gemini-3-pro-image). FOUR A MINUTE IS FIFTEEN SECONDS BETWEEN CALLS - which is why the batch route's documented 12-second wait exists; it was never arbitrary caution, and anything faster refuses whatever model is chosen. ⚠ CONCURRENT TOOLS COMPETE: an overnight pipeline slice eats the same 4/min a Review-tab bulk fix is trying to use. ⚠ THESE QUOTAS ARE ADJUSTABLE - the real fix is a quota increase (Quotas > Increase Requests, or the quota adjuster under Configurations). Pacing only makes the tools survive the limit; it cannot make them fast. ⚠ DO NOT DIAGNOSE FROM THE APP: "Current usage > 90%: 0" can read reassuringly while requests are still refused - the per-minute counters are bursty and the console lags. Read the quota VALUE for the model in use, not the usage percentage, and filter the ~44,000 rows by model name.

# AI cost — prompt caching + the run price estimator (built 2026-08-04)

Prompted by an Anthropic Console showing **$4.73 spent for ~10 test messages**. Two things came out of it.

## ⚠ First, the finding that matters: the Hub was NOT the spend

Checked against production: there is **no \`ANTHROPIC_API_KEY\` in the environment** and the **\`ToolModel\` table has zero rows**, so every AI tool falls back to its Gemini default and the Hub cannot make a Claude call at all. If Claude API spend appears again, that is Claude Code or the Console Workbench on the same key — **Console → Usage** breaks it down. Don't go hunting in the Hub first.

## 1. Prompt caching (Claude only)

\`AiRequest\` gained **\`cachePrefix?: string\`** — big *repeated* context that goes BEFORE the prompt. On Claude it's sent as its own block with \`cache_control: {type:"ephemeral"}\`; the \`system\` prompt is now sent in block form with the same marker. Gemini has no equivalent here, so it just gets the text glued in front of the prompt.

- **Caching is a prefix match.** The stable text must come first and the varying text after. ⚠ Anything that changes per call (a question, a timestamp, an id) above a marker invalidates the cache every time and you pay the +25% write premium for nothing.
- Re-read costs ~10% of input price; the write costs 25% more, so it pays off from the **second** call reusing the prefix (a 300-lot batch reuses one instruction 300 times).
- A prefix under the model's minimum (512 tokens on Opus 5, 1024 on Sonnet 5) simply isn't cached — no error, no write charge — so marking a short one is harmless.
- **Wired up in BC Source "ask the code"** (\`app/api/it-tools/bc-source/chat/route.ts\`): instructions + source files → \`cachePrefix\`, **only the question** → \`prompt\`. That split is the whole point; putting the question back in the prefix caches nothing.
- \`generateAnthropic\` logs \`cache: wrote N, read N\` — a permanent \`read 0\` means a silent invalidator crept into the prefix.

## 2. The run price estimator

**\`lib/ai-pricing.ts\`** (pure, importable client-side) holds \`DEFAULT_RATES\` in **USD per 1M tokens** plus the token maths. **\`components/run-cost-estimate.tsx\`** renders the panel; it appears above the Run button on **Auction AI → Batch Run** and **Auto Pipeline** (pipeline passes \`passes={3}\` — Batch, Key Points, Double Check).

⚠ **Three deliberate honesty rules — don't "improve" them away:**
1. **A model with no known price shows "Price not set", never $0.** Anthropic's rates are published and exact; Google's model *ids* (\`gemini-3-flash-preview\`) don't match the names on their price page, so those rows carry \`confident: false\` and the UI labels them **Assumed**. An invented number is worse than no number.
2. Unknown Claude ids fall through to Opus pricing — an estimate must never **under**-quote.
3. The panel says on screen it's a rough estimate. Lot counts and photo counts are real (read off the screen); **tokens-per-photo and reply length are assumptions** (\`TOKENS_PER_PHOTO\` = 1032 Gemini / 1600 Claude, ~4 chars per token).

**Admin → AI Models** gained a *"What each model costs"* section: per-model In $ / Out $ boxes, tagged Published / Assumed / Yours. Saving writes **\`AiModelRate\`** (**NEEDS Run Migrations**) via \`PUT /api/ai-rates\` (admins only; \`GET\` is any signed-in user because the estimator needs it). Blanking a row drops back to the built-in default. Reads are try/caught so a missing table degrades to "no overrides" rather than breaking the run tabs.

Sanity-checked on real shapes: 340 lots × 6 photos ≈ **$0.88** on Gemini 2.5 Flash, **$2.65** through the 3-stage pipeline, **$19.51** on Claude Opus 5.
`,
  },
  {
    filename: "admin_centre.md",
    content: `---
name: Admin Centre (/tools/lot-lookup) - ONE page, four buttons, big UI
purpose: The Admin Centre is a SINGLE page - four search-by buttons (Receipt, Tote, Customer, Sale or lot), one box, results inline. The tabs are gone. Deliberately oversized for non-technical admins. Read before touching it.
last_updated: 2026-08-18
---

# Admin Centre — /tools/lot-lookup (rebuilt 2026-08-04, third tab 2026-08-06)

Gated on the **\`ADMIN_CENTRE\`** app key via \`hasAppAccess\` — the page redirect **and** both API routes check it.

## ⚠ The audience is the design constraint

The brief: *"this is getting used by non technical admins so really make everything nice and big and clear."* So this tool deliberately **breaks the Hub's usual 10–12px table style**: base/lg body text, \`py-3\` table rows, \`px-8 py-8\` answer panels, 2px borders, big hit targets, and plain-English wording ("Where from", "Changed to", "Not recorded") instead of raw field/source keys. Shared classes live in **\`app/(app)/tools/lot-lookup/ui.ts\`** — use them rather than re-styling, and **don't "tidy" this back down to the compact house style.** Full width (\`max-w-[1800px] mx-auto\`).

## ⚠⚠ ONE PAGE, FIVE BUTTONS - THE TABS ARE GONE (2026-08-18)

Jordan: "I want to combine all the options on this page to be a single page so keep the find a customers lots and the 3 options but all the data needs to show up on a single page. We also need to be able to search by auction and lot number on the first page. I want to make this as simple and idiot proof as possible." Asked which shape, he chose "Keep the 3 buttons and add a new one for lot number/auction", then on seeing it: "this needs to be like how it was before with a drop down list of the auctions and then an optional lot number box."

It was three tabs, each hiding the other two and each with its own search box - so you had to know which tab answered your question before you could ask it. Now ONE page: pick what you have, fill in the one thing it asks for, and the answer renders underneath.

- Receipt number / Tote number / Customer number -> one box -> FindLotsTab
- SALE AND LOT NUMBER -> a DROPDOWN of real BC sales plus an OPTIONAL lot number -> BySaleTab (filtered to the lot when given)
- BARCODE -> one box (barcode or unique ID) -> WhoCataloguedTab

⚠ EACH BUTTON ASKS FOR EXACTLY ONE KIND OF THING - that is the design. A single "sale or lot" box was built first, with a parser that read F109 / F109 400 / F109400; Jordan rejected it in favour of the dropdown, because a box where you must know which of three formats to type is the opposite of idiot-proof. parseLotQuery was DELETED - don't reintroduce it. The sale list is fetched once from /api/lot-lookup/sale?sales=1 the first time that button is opened, so every code offered is one that actually has lots; a free-text fallback stays underneath for a brand-new sale or if the list fails to load.

- ⚠ The three tab components still hold ALL the rendering and their result markup was deliberately left untouched - it is the part checked against real BC data. lookup-client.tsx passes each a 'controlled' prop, which hides that component's own search card and runs the query given to it. A 'nonce' bumps on every Search press so pressing it twice re-runs the same query.
- ⚠ Their search() functions now take the query as ARGUMENTS (search(q, mode)), not from state - a controlled run happens in the same tick the props arrive, when state still holds the previous search.
- ⚠ onClick={search} had to become onClick={() => search()}: with an argument-taking search, the bare form passes the MOUSE EVENT as the query. TypeScript caught it; it would have searched for [object Object].

## ⚠⚠ WHAT THIS TOOL IS FOR - READ THIS BEFORE CHANGING ANYTHING HERE

Jordan, 2026-08-18, after several rounds of patching the layout without knowing the job: "we obviously get customers who ring in asking questions about there totes and lots like what auction they are in etc so the point of the admin centre is 1 hub to search to find all these answers", "Our admins are not great with computers so this all needs to be simple as possible", and the decisive one: "this customer... had some of her lots made directly in BC and some made in our system. All the admin needs to know is what auction the lots are going into, they might need to know who catalogued it and details like that. So if a lot starts in our system you can use that as what auctions its in using our own dates and sale names; if its a BC only thing that needs to be pulled in as well."

SO: ONE LIST OF THE CUSTOMER'S LOTS, GROUPED BY THE AUCTION THEY ARE GOING INTO, AND THE ADMIN NEVER NEEDS TO KNOW WHICH SYSTEM A LOT CAME FROM. Anything that exposes the Hub-vs-BC split is a bug in this screen, however accurate it is.

⚠⚠ BC's auctionCode IS OFTEN A HOLDING PEN, NOT AN AUCTION. Measured on production 2026-08-18: A995 "Temp F109 Bears" (570 items), A992 "Temp F110 - Dolls and bears day 2" (424), A999 "Lost/Missing/Re-Receipted & Lots with BC Issues" (130), A996 "Temp F119 Trains" (2), A998 "Unsold Mover" (2). Grouping by BC's field put "A995 - Temp F109 Bears - 1 Jan 2099" on screen as though it were a sale. For customer C223610 that produced THREE groups - 93 placeholder lots in a fake auction, 49 in F109, 1 loose - for what is really ONE sale.

⚠ THE BARCODE NAMES THE SALE, AND BEATS BC's FIELD. F109034 -> F109. Measured across the 211,229 BC rows with a real auction code, the barcode prefix agrees 199,901 times (94.6%), and ALL 692 A995 placeholders carry an F109 barcode - the sale they are actually for.

resolveSale() in the route therefore goes: OUR auction if we catalogued it -> else the sale the barcode names PROVIDED WE HOLD THAT SALE (self-validating; a stray prefix cannot invent one) -> else BC's code ONLY if it is not a holding pen -> else "Not in a sale yet". The name and date always come from OUR CatalogueAuction record once the code is known. Result for C223610: 142 lots under "F109 Dolls & Bears - Day 1", plus the one genuinely unallocated.

⚠ A999 is the exception that DOES matter - it is BC's problem pile, so needsAttention marks those rows and their sale block amber. Don't lump it in with the Temps.

⚠⚠ THE HUB ALWAYS WINS - BC IS ONLY EVER THE BACKUP. Jordan, 2026-08-18: "the lot is in the hub which it should always be using first and only checking BC for backups - if there is overlaps the hub should always win."

⚠⚠ THE REAL ROOT CAUSE - THE SYNC NEVER DELETES (corrected 2026-08-18, after Jordan showed BC's own screen). The "duplicate barcodes" were mostly GHOSTS: rows DELETED in live BC that our upsert-only sync kept forever. Verified against live BC: receipt R008537 returns 50 rows live but our cache held 143 - the 93 extras were A995 temp lines BC deleted when the items were re-receipted, whose barcodes now belong to other customers' lots. ~1,800 A9xx rows cache-wide had the same shape. FIXED AT THE SOURCE: Data Sync stage 8 (sync/reconcile-deleted) - checks each suspect receipt (any with an A9xx row) against LIVE BC and removes what BC no longer has; deletes NOTHING on an empty or failed BC answer; also runs at the end of the nightly bc-warehouse cron. The display-level guards below stay as belt-and-braces for the window before a sync has run. Two display consequences, both fixed: (1) pickBcFor() - matching a Hub lot to a BC row on barcode alone used a Map, so WHICHEVER ROW WAS WRITTEN LAST WON and a lot could display A DIFFERENT CUSTOMER's BC record; the RECEIPT now decides, the customer is the second check, and an ambiguous barcode attaches to NOTHING rather than guessing. (2) IF THE HUB KNOWS THE BARCODE AT ALL, A LEFTOVER BC ROW FOR IT IS DROPPED - not shown, and not merged in. Measured on tote T024817 (receipt R008537, Lita Morgan): 142 BC rows, 110 of whose barcodes the Hub holds - only 17 genuinely on that tote, and 93 belonging to lots on receipt R009145, tote P006301, customer Nicola Johnson. Either way the BC row is wrong: if the Hub lot is in this search the real row is already there, and if it is not, the item is not on this receipt at all. ⚠ A FIRST ATTEMPT IMPORTED the Hub lot's details onto those rows instead of dropping them - which dragged another customer's tote (P006301) onto the screen and made it look worse, not better. "The Hub wins" means the Hub's PLACEMENT wins too. ⚠ The dropped count is REPORTED ON SCREEN (phantoms in the response), never silently swallowed - design rule 7.

⚠ "CATALOGUED BY" - BC KEEPS THE NAME IN THREE FIELDS AND THE OBVIOUS ONE IS USUALLY EMPTY. EVA_CataloguedBy is a short code ("KS") and is BLANK ON TENS OF THOUSANDS OF LINES. Sampling 200 catalogued lines with a blank one: 98 had EVA_CataloguedByUser, ALL 200 had EVA_CreatedBy - both Windows usernames ("ANNABELL.FENBY"). Synced as cataloguedByUser / bcCreatedBy (NEEDS Run Migrations AND a receipt-lines Data Sync before they hold anything). bcPersonName(cataloguedBy, cataloguedByUser, createdBy) in lib/cataloguer-directory.ts is the ONE place that turns any of them into a person: the code through CATALOGUER_DIRECTORY, then a username matched to a directory EMAIL local-part (jake.kenyon@... = JAKE.KENYON), then title-cased as a last resort. The Hub's own createdByName still wins over all of it.

⚠ THE ROW SHOWS THE ANSWER, NOT THE PLUMBING. Columns are Lot / Item / Tote / Catalogued by / Where it is up to. The old "1 - In the Hub" / "2 - In Business Central" pair, the "In BC" / "Never catalogued here" cells and the "17 in both / 32 BC only" chips are GONE - they were internal state dressed up as an answer. The lot number leads, because that is what a customer rings up asking for.

⚠ formatSaleDate now blanks dates more than 5 YEARS IN THE FUTURE as well as pre-1990 ones. BC uses 0001-01-01 for "no date" on real rows and 2099-01-01 on the holding pens, and the latter was printing as "1 Jan 2099".

## ⚠ THE RESULTS LAYOUT: TOTES FIRST, THEN THE SALES (2026-08-18)

Jordan: "For starters remove the how a lot gets here section. Then in its place we should have a totes section... So based off whatever you search it smart matches to find everything a customer may have. The tote table needs to just have the tote number the date it was created the main and sub category and if it had been ticked as catalogued. Then underneath that a table of all the auctions with a expandable list that shows all the lots and details we have now." He also had the three stat tiles removed (in both / not yet in BC / BC only).

GONE: the "How a lot gets here" explainer panel, and the three Stat tiles (the Stat helper was deleted with them).

TOTES TABLE, FIRST. Tote / Created / Category / Sub-category / Catalogued, with a count and a catalogued-vs-still-to-do split in the header. Shown for EVERY search type, not just a tote search - receipt gives every tote on that receipt, tote gives the whole receipt so its siblings show, customer gives every tote for that customer number.

⚠ WarehouseTote.category / subCategory are NEW COLUMNS (NEEDS Run Migrations), filled by sync/totes-all from the eva/tot custom API. ⚠ The field names - articleCategory / articleSubcategory - were READ OFF A LIVE BC ROW, not guessed. bcTotApiUrl(token, "receiptTotes") returns camelCase: receiptNo, toteNo, vendorNo, articleCategory, articleSubcategory, articleSubcategory2, contentsDescription, catalogued, cataloguedAt, cataloguedBy, toteLocation, systemCreatedAt. Both columns are written behind an information_schema guard - the same deploy-before-migration pattern bcCreatedAt already used - and the lookup route falls back to a select without them. THE CATEGORIES STAY BLANK until a totes-all sync has run since the migration.

⚠ The date shown is bcCreatedAt (BC's systemCreatedAt), NOT syncedAt - 20,182 of 21,789 totes have one.

⚠ THE TOTES TABLE SCROLLS INSIDE ITSELF (max-h-[26rem], sticky header). A busy customer has hundreds of totes - measured 341 on C002603 - and an unbounded table pushes the sales section, the other half of the answer, off the screen.

## ⚠ SALE GROUPS ARE COLLAPSED BY DEFAULT (2026-08-18)

Jordan: "Just show all the sales they have lots in and how many then make the list expandable to see all the details of the individual lots?" A customer's lots can span a dozen sales and hundreds of rows, and the first question is WHICH SALES their stuff is in, not show me every lot.

So in Find lots each auction band is a BUTTON: code, name, date, item count and the in-both / not-in-BC / BC-only counts, with "Show the N lots" on the right. The item table is hidden until it is opened.

⚠ A result with only ONE sale OPENS ITSELF (open[key] ?? groups.length === 1) - collapsing a single answer is just a click in the way. A new search resets everything to collapsed. An "Open them all" / "Collapse them all" button appears once there is more than one sale, next to a summary line that now leads with the number of SALES.

## The files

| File | What |
|---|---|
| \`lookup-client.tsx\` | shell + the two big tab buttons (\`useState\`, no URL param) |
| \`find-lots-tab.tsx\` | the original receipt / tote / customer lookup, redesigned |
| \`who-catalogued-tab.tsx\` | one lot in, one name out |
| \`by-sale-tab.tsx\` | pick a sale, search it by BC lot number (2026-08-06) |
| \`ui.ts\` | shared classes + the plain-English label maps + date formatting |
| \`app/api/lot-lookup/route.ts\` | the cross-system search (behaviour unchanged) |
| \`app/api/lot-lookup/who/route.ts\` | one lot in, who catalogued it out |
| \`app/api/lot-lookup/sale/route.ts\` | new — a whole sale by BC lot number (2026-08-06) |

## Tab 2 — "Who catalogued this lot?"

Scan/type a **barcode** (\`F066001\`) **or a unique ID** (\`R000016-413\`) — both identifier fields are matched, non-ASCII stripped first (scanners emit junk). Returns a **list**, because the same barcode can legitimately appear in more than one sale.

Three layers of answer, in this order:
1. **\`CatalogueLot.createdByName\` is the authoritative answer** — the huge name at the top, with \`createdAt\`. It is blank on old/imported lots; the card explains that in plain English rather than showing nothing.
2. **What BC says** — \`WarehouseItem.catalogued\` / \`cataloguedBy\` / \`cataloguedAt\`. ⚠ BC stores a **staff CODE** ("KS"), so it is resolved through **\`lookupCataloguerByCode\`** (\`lib/cataloguer-directory.ts\`) — never show the raw initials. The same resolution was added to the **Find lots** tab's BC table.
3. **Everyone who has changed it since** — grouped from **\`CatalogueLotEvent\`** (the Lot Change Log audit trail) with a "Show the full history" table. ⚠ That log only covers lots edited **since 1 July 2026**, so "no changes recorded" is normal for older lots and the UI says so.

An item found in BC with **no** matching Hub lot gets its own orange "Found in Business Central only" card.

## Tab 3 — "Who catalogued this sale?" (2026-08-06)

Jack's ask: *"I need to look at the sale with the lot number in from BC then see who catalogued it on our system."* Pick a sale (dropdown built from BC's own \`auctionCode\` values, newest first, with lot counts — or type the code), then a **lot number** box filters the loaded sale as you type. A single match shows the big one-answer card; otherwise the whole sale, ordered by lot number with unnumbered lots last. Plus a per-cataloguer tally you can click to filter.

### ⚠⚠ BC's \`cataloguedBy\` is the IMPORT STAMP, not the cataloguer

**This is the entire reason the tab exists.** Jack: *"because we import the lots in they all say they are catalogued by me and Jordan."* Lots are pushed into BC in bulk, so \`WarehouseItem.cataloguedBy\` records **whoever ran the import** on every lot in the sale. The real cataloguer is **\`CatalogueLot.createdByName\`** — the same field Manage Lots shows as its **"Added By"** column. So the tab reads the **lot number from BC** (which only exists there) and the **cataloguer from the Hub**. BC's stamp appears only on rows with no Hub match, explicitly labelled as the import stamp. **Never present BC's \`cataloguedBy\` as the cataloguer.**

### ⚠ Match on the UNIQUE ID first here, barcode only as fallback

The opposite order to Tab 1. A barcode is **scoped to the sale the lot went into** — measured 2026-08-05, receipt R008771's items carry \`F069598\` in sale F069, \`F078380\` in F078, \`F080575\` in F080, \`F083155-60\` in F083. So an item re-entered into a later sale picks up a **different** barcode, and matching barcode-first can attach the wrong lot — and the wrong cataloguer — to a re-sold item. Measured on F103: 585 matched by unique ID, only 16 needed the barcode fallback. Both sides are \`trim()\`ed before comparing.

### ⚠ On STAGING this tab looks broken, and isn't

Staging's Hub has ~3.9k lots across ~8 sales; its BC cache has **212k items across hundreds of sales**. So almost any sale you pick from the dropdown has no Hub lots at all and every row reads "Not in the Hub". Test on a sale staging actually holds — **F064, F103, F106, F091, F104**. It cost a debugging cycle on 2026-08-05.

## Tab 1 — Find lots: ONE merged row per item (reworked 2026-08-04)

The two side-by-side Hub / BC panels are **gone**. They made the journey impossible to follow, because the same physical item appears on each side under a different number (\`F090447\` in the Hub, \`R008414-7\` in BC). Now: **one row per item**, grouped under a big labelled **Auction** header band (code · name · 📅 date · counts), with columns *Item · Catalogued by · 1 · In the Hub · 2 · In Business Central*, an explainer strip showing the Hub → BC flow, and three tiles — in both / Hub only / BC only. \`hub[]\` and \`bc[]\` were dropped from the API response; it returns \`rows[]\`.

### ⚠⚠ "In BC" is matched on the BARCODE — never on \`CatalogueLot.addedToBC\`

\`addedToBC\` is a **manual tick the cataloguers rarely make**. Measured on production for receipt R008414 (2026-08-04): **44 Hub lots, only 11 ticked, but 44/44 matched a BC item on barcode.** The route therefore runs its own \`WarehouseItem\` query on the lots' barcodes (falling back to \`receiptUniqueId\` ↔ BC \`uniqueId\`) — a separate query, because a lot can be in BC under a different receipt from the one searched. ⚠ Prisma \`in\` is **case-sensitive**, so it queries original/upper/lower variants and matches case-insensitively in code. The Who-catalogued tab's BC chip uses the same real match. **Don't "simplify" either back to \`addedToBC\`.**

### ⚠ "Made from tote" — trust the HUB's tote, not BC's

There is a **Made from tote** column. It shows the HUB's tote, falls back to BC's WarehouseItem.toteNo (marked "from BC"), and flags an amber "⚠ BC says …" when they disagree. CATALOGUED BY works the same way: CatalogueLot.createdByName first, then BC's resolved name (marked "recorded in BC"). Don't flip either preference round - the Hub is where the work was actually done. ⚠ A PREVIOUS VERSION OF THIS NOTE SAID BC's toteNo IS "ALMOST ALWAYS EMPTY" - THAT WAS WRONG, generalised from one receipt (R008414: only 2 of 52 BC items had one). Measured across the WHOLE synced table on 2026-08-18: 192,858 of 216,244 items have a toteNo (89%) and 165,764 have a cataloguedBy. The BC fallback is doing real work on most rows; do not remove it as pointless.

### ⚠ The lot number is \`currentLotNo\`, NOT \`lotNo\`

BC's \`lotNo\` is \`0\` on these rows while \`currentLotNo\` holds the real number (166, 167…). Always read \`currentLotNo || lotNo\`, and show "No lot number yet" rather than a bare 0.

### ⚠ Lot STATUS is not shown anywhere in this tool

It had been removed once already (same call as Manage Lots — it reads ENTERED on virtually every lot and tells an admin nothing). It came back only because it was in the original lookup component that got redesigned. \`STATUS_TONE\` was deleted from \`ui.ts\` and a comment left in its place. **Don't reintroduce it.**

A **"Catalogued by"** column shows the Hub's \`createdByName\`, falling back to BC's resolved name (marked "recorded in BC").

## Sale date

Every sale is shown with its **date** — a 📅 chip on each sale group in Find lots, and part of the Sale line in the Who-catalogued cards. ⚠ Two different sources: the Hub sends \`CatalogueAuction.auctionDate\` (a real DateTime → ISO), BC sends \`WarehouseItem.auctionDate\` as a **plain string** and uses **\`0001-01-01\` for "no date"**. \`formatSaleDate\` in \`ui.ts\` handles both and blanks anything before 1990 — don't format these dates inline anywhere else. BC also leaves the date off some rows of a sale, so the grouping takes the first non-empty one.

## 2026-08-19 — 📍 "Where it is" on the Barcode search

Jordan: "when you search by barcode there is no location section. Would it be possible to also location history as well? We have a tab for that in the BC warehouse section". This is the page's core job — customers ring up asking where their things are — so location now gets its own card instead of being one small Fact among five inside "What Business Central says", where it already was and was easily missed.

Barcode search renders WhoCataloguedTab (lookup-client.tsx, run.mode === "code"). The new WhereItIs card sits directly under the big "Catalogued by" answer and above the cross-check grid, and again on a BC-only row.

TWO SOURCES, DELIBERATELY SPLIT. The CURRENT LOCATION comes free with the search — it is already in the synced warehouse data (bc.location), so it paints instantly. The MOVE HISTORY is a LIVE BC call, so the card fetches it itself, per card, AFTER the answer is on screen: an admin with a customer on the phone gets the location immediately and watches the history fill in. ⚠ Never make the main search await this.

⚠ It REUSES /api/bc/location-history — the route behind BC Warehouse → Location History. RULES.md forbids changing that TAB (it was accidentally replaced once and had to be restored by hand). Calling its route is fine; never "tidy" the shared endpoint to suit the Admin Centre.

⚠ QUERIED BY BARCODE, NEVER THE UNIQUE ID — the route's barcode mode matches on the Internal Barcode change-log value, so a unique ID finds nothing. Consistent with the house rule that BC membership is decided on barcode alone. The card takes bc?.barcode || lot.barcode, so a search typed as a unique ID still resolves to the right barcode.

Failure states are worded as ordinary outcomes, never errors: not connected → "Connect to Business Central to see the move history"; 404 → "Business Central has no move record for this barcode"; empty list → "No moves recorded — it hasn't been moved since it was put away". A lot with no moves is normal and must not look like a fault. Most recent row highlighted and labelled, matching the BC Warehouse tab. Sizing follows the oversized ui.ts — don't compact it.
`,
  },
  {
    filename: "item_valuations.md",
    content: `---
name: Item Valuations (/tools/cataloguing/research) — price a customer's photos
purpose: Drag customer photos in, get a priced list to quote from. Explains WHY every figure leans low and where the safety margin lives. Read before touching the valuation maths or lib/comparables.ts.
last_updated: 2026-08-06
---

# Item Valuations (built 2026-08-06)

Jack's ask: *"our cataloguers get sent photos and they want to value the items… we usually estimate between 30-40% lower than they would actually sell for to be safe… if it's just a bunch of loose shit just give a very rough guess."*

The page is **tabbed — Valuations (default) / Search**. Search is the original quick-launch screen, moved to \`search-tab.tsx\` unchanged.

## ⚠ Called "Research" until 2026-08-06 — the ROUTE did not change

Jack renamed it to **Item Valuations** (sidebar label and heading, icon 🔍 → 💷) once valuations became the point of the page. The folder is still \`/tools/cataloguing/research\` **on purpose**: the URL is bookmarked, and **\`/api/research/log\`** feeds \`ResearchLog\` → the cataloguing reports. Renaming the folder breaks both for no gain. Expect the old name in URLs, API paths and the \`RESEARCH\` sidebar key.

## ⚠ The figures must come in UNDER what things really make

Quoting high and selling low is the failure that matters, so every choice leans low. Don't "improve" any of these into a higher number:

1. **Anchored on OUR OWN sold archive**, not the model's memory of prices. \`WarehouseItem\` holds **193,004 rows with a real \`hammerPrice\`** (checked 2026-08-06). Retail/asking/eBay-BIN prices all run materially above auction hammer, and that is what a model recalls.
2. **MEDIAN of single-item sales, never a mean.** Measured: Steiff bears span £30–£2,300 — a mean is dragged far above what a normal example makes. The "usual range" is the interquartile band.
3. **Group lots are EXCLUDED from every figure** and counted separately. A *"group of six to include…"* price is for the six; averaging it into a per-item valuation inflates it. Corgi 261: 159 matches, 24 of them group lots.
4. **A mixed lot gets ONE low-confidence row**, not invented detail, and is **not** looked up in the archive — a vague "assorted diecast" match would make the figure look better-founded than it is.

## ⚠ The safety margin is applied in the CLIENT, not the prompt

Default **35%**, adjustable 0–50% on a slider. \`/api/research/valuation\` returns **honest market figures** and \`valuations-tab.tsx\` takes the percentage off, rounded to the nearest £5. This is deliberate: in the AI prompt it would be invisible and would silently drift away from what the business actually quotes. **Don't move it into the prompt to "save a step".**

Every price and item name is **editable**, and rows deletable, before Export to Excel — the cataloguer has the customer's email and the experience; the AI only has a photo.

## \`lib/comparables.ts\` — SHARED, don't fork it

The archive search was lifted out of \`/api/catalogue/lens\` so Lens and Valuations use **one** copy. The scoring is scored-not-all-or-nothing and was arrived at by measurement (see the ⚠ comments in the file — requiring every search term returned 0 matches where dropping one returned 436). A second copy will drift. Lens re-exports the \`Comparable\` type because \`lens-button.tsx\` imports it from the route.

## Wiring

- **\`research_valuation\`** slot in \`AI_TOOLS\` — model set in Admin → AI Models, never hardcoded. Uses Google Search grounding, so the configured model must support it (the route says so if it doesn't).
- Up to **20 photos** a request; \`maxDuration\` 300s.
- **Nothing is saved.** Export to Excel and it's gone — no schema change, no Run Migrations. Persisting valuations would be a new table and a deliberate decision.
- ⚠ **The invisible research timer must stay mounted on \`page.tsx\`, not inside a tab.** It feeds \`ResearchLog\` → the cataloguing reports and their PDFs; inside a tab, switching tabs would restart the clock and lose the time.
`,
  },
  {
    filename: "warehouse_filter_table.md",
    content: `---
name: BC Warehouse — Excel filters + print what's on screen
purpose: Every BC Warehouse results table uses the shared <FilterTable> (click-a-column Excel dropdown) with a PDF that prints the filtered rows. Read before touching those tables or adding a new one.
last_updated: 2026-08-04
---

# BC Warehouse results tables — Excel-style filters + PDF (built 2026-08-04)

The ask: make the \`/tools/bc-warehouse\` results filterable **"like Excel — you click on it and it tells you all the options"**, with a printable PDF. Applied to **every** results table, and **the PDF prints exactly what is on screen**.

## The two shared pieces — use them, don't hand-roll another table

- **\`components/filter-table.tsx\`** → \`<FilterTable>\` + \`FilterColumn<T>\`. Click a column heading and you get the Excel dropdown: **Sort A→Z / Z→A**, a **search box**, **(Select all)**, and a **tickbox per distinct value with counts**. The header bar shows \`Title · X of Y\` when filtered, plus **✕ Clear filters** and the **🖨 PDF** button.
- **\`lib/warehouse-table-pdf.ts\`** + **\`POST /api/warehouse/table-pdf\`** — Vectis-branded A4 sheet (auto-landscape above 5 columns), repeating column header, banded rows, page numbers.

## Four things that are deliberate — don't "simplify" them away

1. **The client posts the finished strings.** \`<FilterTable>\` sends its visible rows, already filtered and sorted, as \`string[][]\`. The route does **no** lookup, filter or sort, so the sheet can never disagree with the screen. Don't make the route re-query BC "to be safe".
2. **The dropdown is rendered in a \`createPortal\` at fixed position.** These tables sit inside \`overflow-y-auto\` panes that would clip an absolutely-positioned panel. It closes on outside click / Escape / any scroll that isn't inside the panel itself.
3. **Options are computed under the OTHER columns' filters** (real Excel behaviour), so the values offered are ones that still exist in the rows you can see.
4. **An empty selection is a real filter that matches nothing.** A key being *present* in \`filters\` means that column is filtered; untick everything and the table empties (with a "Clear filters" link in the body). Everything ticked deletes the key = no filter.

Other props: \`resetKey\` (change it — e.g. to the search term — and the filters drop, so a stale filter can't silently empty a new search), \`initialRows\` (the "Show all N rows" button), \`rowClassName\` (kept Sale Checklist's red missing-item rows), \`onVisibleChange\` (lifts the visible rows for a caller's own export), and per column \`render\`, \`filterable: false\`, \`pdfWidth\` / \`pdfHide\`.

⚠ Each column needs a **plain-text \`value(row)\`** — that string is what filtering, sorting AND the PDF all use. \`render\` is only for the on-screen cell (badges, colours).

## Where it is wired in

| Tab | Table |
|---|---|
| Search by Location | Totes **and** Items (Location column still only in aisle mode) |
| | ⚠ The **totes** columns are Tote No · Location · Receipt · **Customer no** · Customer. Status and State were **deliberately dropped** on 2026-08-04 (not needed) and \`vendorNo\` added in their place — \`/api/warehouse/tote/report\` had to start selecting \`vendorNo\`. Don't put Status/State back. |
| Tote Data | Raw Data view (kept the 150-row "Show all" behaviour via \`initialRows\`) |
| Unsold Items | the flat list (Group-by-vendor view unchanged, no filters there) |
| Sale Checklist | the per-auction item table inside the accordion |

⚠ **Unsold Items has TWO PDFs and both follow the filters.** The green button is the **picking sheet** (per-aisle pages with tickboxes) — \`app/api/warehouse/unsold-items/pdf/route.ts\` gained a **POST** handler that builds the same sheet from client-supplied rows, fed the visible rows via \`onVisibleChange\`. The old GET (re-queries BC for whole aisles) still exists; don't switch the button back to it or the sheet would print rows the user filtered out.
`,
  },
  {
    filename: "departments.md",
    content: `---
name: Departments — sale access + reports
purpose: Departments link auction types to staff; drives who sees which sales + the Manager Portal Departments tab. Read before touching department, sale-list or Manager Portal code.
last_updated: 2026-07-27
---

# Departments (built 2026-07-27) — the link between sale types and staff

A \`Department\` now carries **\`auctionTypes String[]\`** — the \`CatalogueAuction.auctionType\` values it covers. That is the whole mechanism: a sale belongs to the department covering its type, and people are linked to departments, so a cataloguer sees their own departments' sales.

**Schema (NEEDS Run Migrations):**
- \`Department.auctionTypes String[]\`
- \`UserDepartment\` join table — **many-to-many**, a cataloguer can cover several departments (holiday cover, someone who does both Diecast and Matchbox)
- \`CatalogueAuctionAccess\` (auctionId + userId + grantedBy) — the one-off "she's covering this one sale" override
- \`User.departmentId\` is **legacy** — kept only so pre-migration data survived (the migration backfills it into \`UserDepartment\`), and roughly kept in step by \`setUserDepartments\`. **Nothing reads it for access decisions.**

## ⚠ Two deliberate "sees everything" cases — don't "fix" them

\`lib/departments.ts\` → \`getDepartmentAccess(userId, role)\` returns unrestricted when:
1. the person is in **no department** (Jordan's call — nobody gets locked out the day this ships), or
2. their departments **cover no auction types yet** (departments created but types not mapped).

Plus every read is wrapped in try/catch falling back to unrestricted, because **code reaches Railway before Run Migrations is clicked** — a missing table must never empty the sale lists or 500 the page. Admins are always unrestricted.

Helpers: \`auctionWhere(access)\` (spread into a Prisma \`where\`), \`canSeeAuction(access, auction)\`, \`getDepartmentAccessForSession(userId)\`.

## Where the filter is applied

Auction Manager (\`/tools/cataloguing/auctions\`), Tablet (\`/tools/cataloguing/tablet/auctions\`), Photography, the Auction AI auction dropdown (\`/api/auction-ai/auctions\`), and the transfer-lots target list. **The sale page itself (\`auctions/[id]\`) re-checks and redirects** — hiding from a list is not a restriction, a pasted URL would still open it. Denials log to the existing Access Log with \`source: "auction_department"\`.

⚠ **Any NEW page that lists or opens sales must apply \`auctionWhere\` / \`canSeeAuction\` too**, or it becomes the way round the restriction.

## Admin → Departments (/admin/departments)

Rebuilt as cards: rename inline, tick the sale types it covers (a type belongs to **one** department — ticking it elsewhere **moves** it, and the button says which department currently holds it), staff + sales counts, member chips, plus an "unassigned sale types" panel. Server actions in \`lib/actions/admin.ts\` **return \`{ok, error}\` rather than throwing** (production redacts thrown server-action messages, and "that name is taken" needs reading).

Users pages: the single Department dropdown is now **tickboxes for several**, on both the create and edit forms, saved by \`setUserDepartments\`. The users list shows a comma-separated list.

## Manager Portal → Departments tab

\`/tools/manager-portal\` is now **tabbed**: Sales (the original table, lifted unchanged into \`sales-view.tsx\`) and Departments (\`departments-view.tsx\`). Both registered in \`APP_SECTIONS.MANAGER_PORTAL\` in \`lib/apps.ts\`, so the per-section tickboxes on the user permissions page work automatically — that is how the Departments tab gets its separate permission. Nobody had stored Manager Portal section settings before this, so existing users keep seeing both tabs until deliberately restricted.

**Not date-range based** (Jordan, 2026-07-27 — the original 7/30/90/all range selector was scrapped as confusing). It shows **active sales** per department, with a **"Completed in the last 3 months"** strip underneath. There is no "completed at" timestamp — \`complete\` is just a flag — so recency uses \`auctionDate\`, falling back to \`updatedAt\`.

Per active sale: sale date + days to go, lot total, pace, and **projected dates for FIXED targets of 400 / 500 / 600 lots** (\`SALE_TARGETS\`) — \`400 → 12 Aug\`. ⚠ These are fixed, **not** the Sales tab's rolling next-hundred marks (Jordan corrected this on 2026-07-27: a 250-lot sale must still project to 400/500/600, not 300/400/500). Green "reached" when already past, red when the target lands after the sale date, grey "no pace yet" under two active days. Plus the cataloguers who worked on the department's sales and the assigned staff.

⚠ **The projection maths lives in \`lib/sale-projection.ts\` and is shared with the Sales tab** (\`paceFor\` / \`daysToSale\` / \`milestonesFor\` were lifted out of manager-portal-table.tsx, which now imports them). The Departments tab uses **\`targetsFor\`** (fixed targets); the Sales tab keeps **\`milestonesFor\`** (rolling next-hundred) — both live in that one file. Do NOT copy either into a third place — two copies will drift and the tabs will disagree about the same sale. Pace = lots ÷ distinct days that actually had lots saved, and needs **2+ active days** before it reports anything.

⚠ Lot totals come from the **same \`/api/manager-portal/bc-counts\` fetch the Sales tab uses** (Hub ∪ BC, deduped by barcode), so a sale reads the same on both tabs; without a BC connection both fall back to Hub-only and the footnote says so. It also keeps the **orphaned-timing-log exclusion** (\`lotId IS NULL OR EXISTS…\`) so figures match the Reports pages.

Sales whose type no department covers land in a **"Not in a department"** group so the totals still add up.

## Layout — rebuilt 2026-07-27 (Jordan: "I hate the layout, it looks awful and disjointed")

Redesign options were mocked up and **Option B chosen**: **ONE table for every sale**, with each department as a tinted **group row** (click to expand cataloguers / assigned staff / completed-in-3-months), and sale rows indented under it. The old per-department card boxes are gone — the faults were stats floating far right detached from the table, and three stacked blocks underneath each department. Above the table sits a **summary section, "Using totes from"**: one line per department, **furthest behind first**, with a lag bar. ⚠ Don't reintroduce per-department cards.

⚠ **Wording: "Using totes from", never "Stock from"** (Jordan's rename).

## Using totes from — how far behind cataloguing is running (2026-07-27)

A **Using totes from** column on the sale rows, and the pooled figure per department in the summary: the **median** date the stock came in across the **last 10 DISTINCT totes worked** on that sale, plus the lag ("14w behind", amber from 6 weeks, red from 3 months). Click it to expand the list of those totes, each with its date and ×N lots, plus oldest/newest.

⚠ **Median, and last 10 DISTINCT TOTES — not the last 10 lots.** Both were Jordan's explicit corrections. Sampling lots is wrong because a run of 10 lots can easily all come from one tote, which tells you nothing; each tote counts once however many lots came out of it. Median rather than average so one stray old tote can't drag the figure back and misreport the lag.

⚠ Empty states are **deliberately distinct and diagnostic** — "no totes" (the sale's lots carry no tote at all) vs amber "no dates" (totes found but none resolved), the latter still expandable to show the raw tote values. A bare dash hid which had happened.

### ⚠ Where a tote's date actually comes from (settled 2026-07-27 the hard way)

\`CatalogueLot.tote\` holds values like **\`T025326\`** and **\`P000865\`**, and they live in **\`WarehouseTote.toteNo\`** — NOT in \`WarehouseContainer.id\` and NOT reliably in \`WarehouseItem.toteNo\`. \`WarehouseTote\` carries **no date of its own** (\`syncedAt\` is just the sync stamp), but it does carry **\`receiptNo\`**, and that receipt's items carry \`goodsReceivedDate\`. **The working chain is tote → receiptNo → \`WarehouseItem.goodsReceivedDate\`.**

**The real date is \`Receipt_Totes_Excel.SystemCreatedAt\`** — when the tote was created in BC. The \`totes-active\` sync already reads that endpoint into \`WarehouseTote\` but never mapped the field; it now stores it as **\`WarehouseTote.bcCreatedAt\`** (NEEDS Run Migrations, and fills in on the next totes-active sync). ⚠ Not \`syncedAt\` — that's just our sync stamp.

Resolution order: (1) **\`WarehouseTote.bcCreatedAt\`**; (2) \`WarehouseItem.toteNo\` direct → \`MIN(goodsReceivedDate)\`; (3) the receipt chain — \`WarehouseTote.receiptNo\` → \`WarehouseItem.receiptNo\` → \`MIN(goodsReceivedDate)\`; (4) last resort \`WarehouseContainer.id\` → \`createdAt\`. Step 1 has a second query without \`bcCreatedAt\` so the receipt fallback still works pre-migration.

## ⚠⚠ BC sends an empty date as \`0001-01-01\`, NOT null

This is a codebase-wide trap, not just a report bug. \`new Date("0001-01-01")\` is a **valid** Date, so \`parseDate\` stored it as real data and the portal read a tote as "24304.3m behind" (~2,025 years). Both \`parseDate\` in **\`app/api/warehouse/sync/receipt-lines\`** and \`bcDate\` in **\`sync/totes-active\`** now null anything before **1990**, and the report's SQL also filters \`goodsReceivedDate >= DATE '1990-01-01'\` so rows synced before the fix don't leak through. **Any new BC date field must go through the same guard** — \`EVA_TOT_CataloguedAt\` is a confirmed example that arrives as \`0001-01-01\`.

Tote dates render with the **year** (\`fmtToteDate\`) precisely because a bare "31 Dec" hid this for a whole round.

## ⚠ bcCreatedAt is EMPTY until the totes-active sync is re-run

Jordan: "you are still getting the dates wrong and it's not finding them". The lookup was correct — \`WarehouseTote.bcCreatedAt\` simply had no data, because the column was added the same day and the **totes-active sync only runs every 12h**. BC's own Receipt Totes page showed \`T024358 · Created At 04/03/2026 11:31\`, so the data exists; ours hadn't been pulled.

**Fix is a sync:** BC Warehouse → **Data Sync** → run totes-active (the UI button paginates to completion via nextLink). ⚠ 2026-07-27 the **nightly cron now also loops totes-active to completion** (was a single ~5000-tote batch from the start, never advancing) — so future tote columns backfill overnight; the FIRST backfill after a deploy is still fastest via the manual button.

⚠ The sync now checks \`information_schema\` once for the column and omits the field if it isn't there — writing a not-yet-migrated column made **every** upsert fail and took the whole tote sync down, not just that field.

## 🔍 Lens — identify an item from a photo (TEST BUILD 2026-07-30)

Tablet cataloguing header, next to Guide / Help: photograph an item → **what it is** + **what we've sold the same thing for**. \`LensButton\` (\`auctions/[id]/lens-button.tsx\`, rendered from \`tablet-tabs.tsx\`) is a **modal for the same reason the guide is** — it opens mid-lot and must not lose the entry in progress. Route **\`/api/catalogue/lens\`**; model slot **\`catalogue_lens\`**.

- **Identify** = Gemini with **Google Search grounding**, reusing the plumbing proven in \`/api/auction-ai/chat-grounded\` (\`tools: [{ googleSearch: {} }]\`). Grounding matters because catalogue numbers recalled from training data are often wrong. Returns structured JSON (maker, model, catalogue no, year, variant, confidence, reasoning, searchTerms) — parsed with a fence-tolerant extractor.
- **Comparables** = our OWN archive, the bit Google Lens can't do: \`WarehouseItem\` has **192,147 rows with a real hammerPrice** (of 209,850) plus auction dates. Verified matching against real data for Corgi, Dinky, Hornby, Steiff, Matchbox.
- ⚠ **SUGGESTION ONLY — nothing writes to the lot.** Gemini identifies boxed/marked items well and confidently guesses at unmarked ones, so confidence + reasoning + the searches performed are shown and the cataloguer decides. Same principle as the batch route: the person holding the item is the authority.
- ⚠ **No size/scale in the output** (Jordan) — they're holding the item, so it wastes the answer.

**Also (2026-07-30):** paste an image straight in (window \`paste\` listener while the modal is open) — ⚠ a separate "Choose / paste" file input is needed because \`capture\` **forces the camera** on a tablet; an optional **note box** sent with the photo (treated as fact — they're holding the item — and answered if it's a question); and up to **3 source links** from Gemini's \`groundingMetadata.groundingChunks\`, so a claim can be checked rather than trusted.

**Experimental notice + suggested key points (2026-07-30).** An amber "🧪 Experimental — still being built" panel sits at the top of the modal **every time it opens**, pointing people at **Jack or Jordan** with problems or ideas (framed as "your feedback shapes what it does next" — the aim is people telling us, not quietly distrusting it). The identification also returns a **ready-to-paste key points line** with a Copy button. ⚠ Style was taken from REAL \`CatalogueLot.keyPoints\`, not invented: they're short plain-text lines, no bullets, e.g. *"Wrenn, OO gauge, 2x ref. W2206 , box inserts included but no instructions"* — three real examples are given to the model as the style guide. Prompt guards: mention box/packaging/completeness/damage **only if plainly visible**, never assumed; stay with what's visible if unsure of the model. ⚠⚠ **The UI warns to read it before pasting** because key points are **authoritative to the batch AI** (it's explicitly told never to overrule them), so anything wrong pasted from here carries straight into the description. Copy falls back to \`execCommand\` when the clipboard API is blocked, which happens on iPads outside a secure context.

**⚠⚠ FOUR matching traps, every one found by measuring against real data — do NOT "simplify" these away:**
1. **NEVER require all search terms (this is why comparables "never worked").** The first version ANDed every term Gemini returned, so one over-specific word wiped out the result: *Steiff + teddy bear + mohair + "button in ear"* → **0** matches (drop one → **436**); *Hornby + OO gauge + Class 800 + GWR* → **1** (drop two → **2,478**). Descriptive words (mohair, camouflage) rarely survive into a lot description, so they must **count towards** a match, never gate it. Now: narrow on maker AND *any one* strong term, then **rank by how much else lines up**; a catalogue-number hit scores most and sorts first.
2. **TWO queries, and the split matters.** The broad query is capped at the most RECENT rows, so on a common maker the genuine catalogue-number matches were truncated away before scoring — *"Dinky 741"* ranked a **Bedford truck** above the actual 741 Spitfires. Catalogue-number rows are now fetched in **their own query first**, then merged/deduped by \`uniqueId\`.
3. **GROUP LOTS.** Much of the archive reads *"Corgi Unboxed Group Of Cars to include 497 Man from UNCLE; 261 James Bond DB5…"* — that £150 is for six cars, not the one in hand. Grouped lots are detected (\`GROUPED\` regex) and shown **separately, excluded from the headline range**. Never average them in.
4. **CATALOGUE-NUMBER SUBSTRINGS.** \`Hornby R351\` also substring-matched **R3514 / R3516 / R3510** — different trains, one at £190. Number-bearing terms need a **whole-word** match. ⚠ Applied **only** to terms containing a digit: forcing whole words on ordinary vocabulary broke plurals and "Steiff bear" missed every *"teddy bears"* lot. Comparison is also **punctuation-insensitive** (\`flatten\`) because the archive writes DB5, D.B.5 and DB.5 — matching stripped descriptions finds 467 rows vs 449.

**Verified after the rewrite:** Steiff 0 → 40 (top hits genuine mohair bear replicas), Hornby 1 → 40, Dinky 741 Spitfires rank top at £90–£130, Corgi 261 DB5 exact matches score 11 and sort first.

## ⚠⚠ NEVER wipe WarehouseTote — its enrichment can't be re-fetched (fixed 2026-07-30)

\`WarehouseTote.bcCreatedAt\` (check-in date) and \`receiptNo\` were historically written **only** by \`sync/totes-active\` from \`Receipt_Totes_Excel\`, and **that feed publishes only totes NOT ticked Catalogued** — so once a tote was ticked, our row was the last copy. ✅ UPDATE 2026-08-06: \`sync/totes-all\` (eva/tot custom API — the FULL 20,561-row receipt-tote table, catalogued included) now re-fetches receiptNo/vendorNo/catalogued/bcCreatedAt for every tote, so those are rebuildable; **vendorName and status remain totes-active-only** (the API carries neither — vendorName backfills from WarehouseItem by vendorNo). The no-wipe rule stands. \`Totes_Excel\` still has nothing to rebuild from (just \`EVA_No, EVA_Description, EVA_Location, EVA_Bin, EVA_ParentToteNo, EVA_ParentCount, EVA_Contents\` + 3 estimate/reserve totals).

- **\`sync/totes\` no longer wipes.** It ran \`warehouseTote.deleteMany({})\` on the first batch of a \`full\` re-sync — so pressing "Full re-sync" destroyed every enriched column and rebuilt rows with **toteNo + location only**. Removed; \`full\` now just means "walk the whole feed". The upsert's \`update\` branch deliberately touches only \`location\`/\`syncedAt\`, so enrichment survives. ⚠ The wipe wasn't pruning anything either: \`Totes_Excel\` holds ~21,428 totes vs ~5,750 in our table, so **our copy is a SUBSET of BC's** — no stale rows exist to clear.
- **\`/api/warehouse/clear-bc-data\` still wipes on purpose** (admin, type-DELETE) — that escape hatch stays, but its "the next sync re-pulls everything" promise is TRUE for items and **FALSE for tote dates**, so the dialog now shows an explicit amber warning whenever totes are included.
- Not a crisis if it ever happens: the Manager Portal's "Using totes from" takes real dates from **\`ChangeLogEntries\`** (table 76800) and only falls back to \`WarehouseTote\`.

## The BC-only table — LIVE from Receipt Totes, bench-filtered (SETTLED 2026-07-30)

One row per **BC article category** (\`EVA_TOT_ArticleCategory\`, straight off the tote feed), **nothing** from our CatalogueAuction/Lot/Department. Component \`BcCategoryTable\` (departments-table.tsx); route **\`/api/manager-portal/bc-tote-dates\`**; the client fetches it async. No "% done". "Last worked" = MAX(WarehouseItem.cataloguedAt) and Catalogued/Still-to-do = item counts by category (the only bits still from our DB, joined by normalised category name).

**Metric AS SHIPPED (rebuilt 2026-07-30 — two endpoints, both needed):**
1. **Sample** = newest 10 totes per category from **\`Receipt_ExcelEVA_TOT_ReceiptTotesSubpage\`** — the WHOLE tote table (**20,418** rows = BC table **76800 EVA_TOT_ReceiptTote**, matches BC's own count), filtered **\`EVA_TOT_Catalogued eq true\`**. \`$filter\`/\`$orderby\`/\`$count\` all work here. ⚠ Only ordering is by tote number and "T…" > "P…" lexically, so **query each prefix separately** or pallets get buried.
2. **Dates** = **\`ChangeLogEntries\`** with \`Table_No eq 76800 and Field_Caption eq 'Tote No.' and Type_of_Change eq 'Insertion'\` → \`New_Value\` = tote no, \`Date_and_Time\` = real creation date. **Verified 10/10 EXACT against BC's own screen.** ~7,100 logged. Falls back to the dated feed → our WarehouseTote → tote-number estimate (marked \`~\`). In practice **0 estimated**.
3. Median of those 10 = the month.

⚠ **Filter on Catalogued, NOT on bench location.** 16,833 of 20,418 totes carry a \`BENCH*\` **last-known** location, so bench-filtering admits brand-new uncatalogued stock — TRAINS' newest bench totes (T026621/T026613) aren't catalogued and made TRAINS look bang up to date. Verified output: SPORTS/TRAINS/MILITARY/BEARS Jun 2026, TOY_FIGURES Nov 2025, 10 totes each. Chips show tote no · check-in date · bench.

**⚠⚠ DO NOT rebuild this from WarehouseItem/receipts — that detour cost ~10 rounds and is all deleted.** Dead and not to be retried: grouping by \`receiptNo\` (put R-numbers in the UI); \`WarehouseItem.goodsReceivedDate\` (populated on **0 of ~208k rows**); \`WarehouseItem.createdAt\` as a date proxy (186k rows bulk-imported on one day, 91d median error); estimating check-ins by interpolating the tote/receipt NUMBER sequence (it actually worked — totes p90 0.6d & 99% right month, receipts median-of-8 p90 7.4d — but became pointless once the right table was used); keying by our departments; "frontier"/newest-catalogued MAX (cataloguing is OUT OF ORDER); \`WarehouseTote.catalogued\` (all-false); WarehouseContainer (different system). All date parsing guards >= 1990 (BC empty date = 0001-01-01).

**⚠⚠ THE TRAP that caused those 10 rounds — remember this one.** TRAINS *items* have \`EVA_CFA_TOT_CreatedFromToteNo\` **blank**, which reads as "trains aren't toted" — WRONG: the TOTE side has 74 TRAINS totes with numbers, dates and BENCH locations. **Never infer a category's tote behaviour from the item feed — look at the tote feed.** (Related earlier red herring: a tote's category label can differ from its items' categories, e.g. a TV_FILM-labelled tote holding GAMING items — irrelevant now that we group by the tote's own category, which is what BC shows Jordan.)

**⚠⚠⚠ WHY \`Receipt_Totes_Excel\` MUST NOT BE THE SAMPLE SOURCE (measured 2026-07-30).** That published web service **returns ONLY totes NOT ticked Catalogued** — 1,776 rows, every one \`EVA_TOT_Catalogued = false\`; ticked totes are absent entirely (a \`$skip\` walk collects all 1,776 DISTINCT rows so it's complete not a paging bug; unfiltered \`@odata.count\` = 1,776; direct lookups of T026013/T025980/T025902 return nothing). That is why SPORTS read **2–3 totes** against BC's ~30. \`$filter\` on \`EVA_TOT_Catalogued\` is ignored there too (true and false both return all 1,776). **No BC change was needed in the end** — the full table was already published as \`Receipt_ExcelEVA_TOT_ReceiptTotesSubpage\`, found by reading **\`$metadata\`** (136 entity sets). ⚠ **The OData service root returns 0 services, so endpoints CANNOT be enumerated that way — always read \`$metadata\`.** (11 guessed endpoint names all 404'd before that.) Keep \`Receipt_Totes_Excel\` only as a secondary date source. ✅ 2026-08-06: an even better full-table source exists — the **eva/tot custom API** (\`/api/eva/tot/v1.0/companies({GUID})/receiptTotes\`, page 76804 in the AL source): 20,561 rows WITH \`systemCreatedAt\` dates and real booleans, now synced by \`sync/totes-all\`. The Subpage endpoint has no date fields, so prefer the API for anything date-shaped.

**Other tote endpoints, measured:** \`Totes_Excel\` 21,428 rows (no dates, no category); \`Receipt_Excel\` 9,447 (⚠ its \`$filter\` is IGNORED — returns the same first row regardless — and no usable arrival date); \`All_Receipt_Lines_Excel\` **117 fields** incl. \`EVA_SystemCreatedAt\`, \`EVA_ReceiptingDate\`, \`EVA_ScannedInDate\`, \`EVA_CFA_TOT_CreatedFromToteNo\` — unexplored, but the richest item feed if an item-level date is ever needed.

**Debugging built in (2026-07-30, Jordan asked for it).** Each month shows its **sample size, amber under 10**, and a **"Where these numbers come from"** expander gives the endpoint, how many tote creations are logged, real-vs-estimated date counts, and a per-category table (totes catalogued in BC / used for the month / dates estimated). Route returns a \`diagnostics\` block feeding it. So a thin category explains itself instead of silently under-reporting.

**Date estimation (fallback only, validated).** Tote numbers are issued in sequence, so an unlogged tote is interpolated between its nearest dated neighbours (T and P are separate sequences; a stray out-of-order anchor falls back to the closer one). Hold-one-out cross-validation: median 0d error, p90 0.6d, **99% land in the correct month**; against 11 known dates from BC's screen every estimate was within **0.6 days**. Estimated dates show a \`~\`. (Receipt numbers are much noisier — median-of-8-nearest, p90 7.4d — don't interpolate those linearly.)

**Hiding categories (2026-07-30).** Admins get a **✕ Hide** per row and a "Hidden from this table" strip underneath (who hid it + ↺ Restore) — new \`ManagerPortalHiddenCategory\` table, \`toggleHiddenBcCategory\` in \`lib/actions/manager-portal.ts\`, same restorable display-only pattern as the report exclusions. The route filters hidden ones out and returns them + \`isAdmin\`; a missing table reads as "nothing hidden" so the deploy can't 500.

⚠ **The dead-button trap (hit + fixed 2026-07-30) — apply this to ANY new-table feature.** The button silently did nothing because the table only exists after migrations are applied, while code deploys to Railway instantly. Two fixes, both worth copying: **(1)** the action detects the missing table (\`P2021\` / "does not exist"), runs the same idempotent \`CREATE TABLE IF NOT EXISTS\` as the migration, and retries once — so it self-heals in that window (the migration stays in the array for fresh environments); **(2)** the failure is now shown **in the card header next to the controls**, not at the bottom of the card below 19 rows of table where nobody would ever see it. A returned-but-unrendered error is indistinguishable from a broken button. Ruled out while diagnosing: \`prisma generate\` DOES run on Railway (it's in the \`build\` script) so the client is never stale, and the admin gate was fine (the button only renders for admins).

**⚠ SINGLE SOURCE: \`lib/bc-tote-dates.ts\` (\`computeBcToteDates(token, hiddenSet)\`).** All the BC work — which endpoints, the Catalogued filter, change-log dates, estimation, the median — lives there, and BOTH the on-screen route (\`/api/manager-portal/bc-tote-dates\`) and the **PDF export** (\`…/bc-tote-dates/pdf\`) call it, so the export can never disagree with the screen. Same reasoning as \`lib/sale-projection.ts\` / \`lib/idle-report.ts\`. Do NOT reimplement any of it in a route.

**PDF export (2026-07-30).** "⬇ Export PDF" on the card header + a "+ totes" variant (\`?totes=1\`) that also lists the 10 totes behind each month. Builder \`lib/bc-tote-dates-pdf.ts\` — pdf-lib, A4 portrait, \`embedVectisLogo\`, headline boxes (categories / furthest behind / most up to date), same red-amber lag colouring as the screen, footnotes explaining the metric + date provenance. Route gated on **MANAGER_PORTAL** app access (the JSON route stays session-only), readable 503 when BC isn't connected. ⚠ **Hidden categories are excluded from the PDF too** (Jordan asked) — the hidden set goes into \`computeBcToteDates\` exactly as the screen route does it. ⚠ **THREE COLUMNS ONLY** — Jordan cut Last worked / Totes / Catalogued / Still to do: the report answers one question (how far behind). Don't add stock counts back without asking; an estimated month gets an asterisk instead.

⚠ **The buttons FETCH the PDF, they are not \`<a href>\` links.** A bare link gave no progress and swallowed the error, so a slow/failing export looked exactly like a dead button ("page loads then nothing happens"). They now show "Preparing…" and put any server error in the card header. **Same rule as the Hide button: never let a slow or failing action be invisible.**

**⚠ Why it's fast now (measured 2026-07-30 — don't undo these).** The BC change-log read alone was **24s** (7,062 rows, 15 pages, BC answers them slowly), and the export recomputed everything, so it felt broken. Three fixes in \`lib/bc-tote-dates.ts\`: **(1)** \`bcPagesParallel\` — count with the first page, then fetch remaining offsets concurrently; **(2)** the change-log rows are cached in-process and topped up with only entries newer than the newest held (\`Date_and_Time gt <iso>\` — verified 200 in **5.5s** for one page vs 24s for the lot; it's append-only history so old rows can't change; full refresh every 12h); **(3)** a **5-minute result cache** keyed by the hidden-category set, so the PDF reuses what the page just computed and hiding a category still recomputes at once. A deploy empties both caches → one slow load, then seconds. ⚠ Module-level caches work here because Railway runs a long-lived Node process (server.js), not per-request lambdas.

⚠ Two dead ends already ruled out, don't retry them: \`WarehouseContainer.id\` (that's the *internal* Vectis warehouse, a different system from the BC-synced totes — \`fillLotsFromTotes\` reads \`tote\` as a container id, which is why the codebase looks ambiguous) and \`WarehouseTote\` having any usable date column.

Totes that still resolve to nothing are **excluded from the median**, and each chip says which step failed. Use **BC Warehouse → DB Explorer** (Warehouse Items / Warehouse Totes, searchable by Tote No) to check a real value before changing any of this.

## Removed at the same time

\`/crm-settings\` (a near-duplicate departments page from an early build) and its CRM sidebar "Settings" link are **gone**, along with the dead department filter/label on the Submissions list — nothing ever set \`Submission.departmentId\`, so that filter never returned anything. The \`Submission.departmentId\` column itself was left alone.`,
  },
  {
    filename: "activity_popup_preview.md",
    content: `---
name: Activity popup (multi-select + split) + admin preview
purpose: The reworked activity/away popup and its admin preview. Read before touching either.
last_updated: 2026-07-23
---

# The activity/away popup — reworked 2026-07-23 (multi-select + time split)

At Jordan's request: heading softened from "What were you doing?" to **"How was this time spent?"**; cataloguers can now **tap ALL reasons that apply** (hint: "Doing more than one thing? Tap all that apply."); with 2+ selected a **"Split the time between them"** panel appears — one slider per reason, live per-reason time, and the message **"A rough estimate is absolutely fine — it doesn't need to be exact."**

⚠ **Sliders are FULLY MANUAL — nothing ever auto-adjusts** (v3, Jordan's final model: v1 proportional shares rejected because dragging one moved values he'd set; v2 pinned-with-flexing-remainder rejected because untouched sliders still moved). Every slider starts at 0m and moves only when dragged; a live **"❔ Not allocated: Xm"** line shows the leftover ("Anything left over is recorded as unallocated time"), and on submit the leftover is logged as a real IdleLog segment with reason key **UNALLOCATED** — a display-only pseudo-reason (\`UNALLOCATED_REASON\` in lib/idle-timer-config.ts, "Unallocated" ❔ grey, NOT in DEFAULT_REASONS so it's never a button/admin row; merged into label maps in lib/idle-report.ts, /api/reports/pdf, collapsible-sections buildReasonConfig). Drags snap to whole minutes, hard-stop at what's unallocated; submit blocked until every selected reason has some time.

**Whole minutes only, rounded UP** (2026-07-23): the big duration + slider times show "13m" / "1h 5m", never seconds — fmtIdleDuration ceils to minutes, slider step/pin snap = 60s, MIN per reason = 1 min. Logged ms stay exact (display-only rounding). **Unallocated warning on submit** (2026-07-24): pressing Log & Continue with ≥1 minute unallocated opens a confirm first ("⚠️ You have unallocated time … Xm hasn't been given to an activity") with "← Go back and allocate it" (default) / "Continue anyway"; \`idleUnallocWarn\`, reset in raiseIdlePopup. Sub-minute crumbs pass silently (sliders snap to minutes). Mirrored in the preview. **"Other" reminder**: tapping Other shows a confirm overlay first ("only use Other when none of the options above cover it") with "← I'll pick an option instead" (default) / "None of them fit — use Other"; keyed on reason key "OTHER". Per-reason note fields (requiresNotes / notePrompt each get their own, prefixed with the reason name when several are picked); the Lunch-Break >65-min mandatory note keys off **lunch's allocated share**, not the whole gap; totes field shows when Lotting Up is among the picks.

**API:** POST /api/catalogue/idle-log now accepts \`segments: [{reason, durationMs, toteNumbers?, notes?}]\` and writes ONE IdleLog row per segment, sequentially offset from idleStartedAt (rows tile the gap, no overlap). ⚠ The **legacy single-reason body is still accepted** — shared iPads run cached old bundles for days. Gap-matching (coveringIdle in lib/idle-gaps.ts) SUMS logs starting in the window, so split gaps stay "explained" for both the Unaccounted Time report and the create-lot gate. Away "sessions" counts tick up slightly when a gap is split — accepted.

## ⚠ Reporting knock-ons of the split — fixed 2026-07-24

Three things the multi-row split broke. **Keep these in mind for any change to how the popup writes rows:**

1. **Unallocated must NEVER excuse a gap** (serious — it reopened the hole the detector exists to close: tick 2 reasons for a minute each, dump hours in unallocated, and the gap read as explained + the save gate cleared). Both covering checks now EXCLUDE UNALLOCATED: \`coveringIdle\` in **lib/idle-gaps.ts** and \`evaluateIdleGate\` in **lib/idle-gate.ts** (\`reason: { not: UNALLOCATED_REASON.key }\`). ⚠ Same rule in two places — keep them in step.
2. **Breaks counted per OCCASION, not per row** — \`groupIdleOccasions()\` (lib/idle-timer-config.ts) regroups the contiguous rows one answer writes (2s tolerance) into one break. Used for sessions / totalSessions / avgSessionMs and the **Longest breaks** table (a split break now shows at its TRUE length, labelled with its biggest slice) in lib/idle-report.ts, plus awaySessions in /api/reports/pdf. Per-REASON counts stay per-row (correct).
3. **"Most Common Reason" + per-cataloguer "usual reason" exclude Unallocated**; it gets **its own figure** instead (\`unallocatedMs\` → a 5th headline card on /tools/reports/activity and a 5th stat box in the Activity PDF, shown only when > 0).
4. **NEVER sum lot time + away time** (found 2026-07-31 from a screenshot Jordan sent: "Today's Productivity" read **6h 22m on lots + 5h 15m away = 11h 37m of an 8-hour day**, and still claimed "100% of expected time accounted for" because that % is \`Math.min(100, …)\` — the cap turned an impossible total into a confident green tick). A break taken **mid-lot is already inside that lot's \`durationMs\`** (deliberate: idle is a SUBSET of a lot's time, never an addition — a lot held up for two hours of research took two hours). The rest of /tools/reports/[userId] already used **\`computeLotBreakdowns\` / \`activeMs\`** from **lib/cataloguing-reports.ts** (overlaps each lot's [savedAt − durationMs, savedAt] window with the idle spans); only \`activeTimeToday\`, which feeds TodayProductivityCard, summed raw durationMs. Fixed by hoisting the shared \`breakdowns\` map above the Today block. ⚠ **Any new figure putting cataloguing time next to away time must use \`activeMs\`, not \`durationMs\`.** Per-lot "how long it took" stays the full duration — that is correct.
5. **Only the BREAK gets a time; the activities inside it get durations** (2026-07-31 — Jordan: "how would it know what time, the cataloguer doesn't pick that part when doing a multi select?"). The popup asks WHAT and HOW LONG, never in which ORDER; the API tiles the rows back-to-back only so they cover the gap, so a per-reason clock time is **invented**. Today's Productivity now groups today's raw logs with \`groupIdleOccasions\` → \`splitIdleByWorkingDay\` into \`TodayBreak[]\` (\`todayBreaks\` in /tools/reports/[userId]/page.tsx) and shows **"When They Were Away"** — one entry per real break (\`09:00 – 10:20 · 1h 20m\`) with activity chips carrying durations. A break that began outside working hours gets a \`↩ began Thu 16:40 — counted from 9am\` chip (that clamping, in splitIdleByWorkingDay, is why several rows used to pile up at 09:00 looking simultaneous). A break spanning two working days shows chips **without** durations plus "part of a longer break", rather than inventing a per-day share. Reason totals became a **"What It Went On"** list with share bars; TodayTimeline draws one bar per break (stacked rows hid each other and made breaks look shorter); the header says "N breaks", not "N sessions".

Verified with a temp tsx suite (10 cases incl. token-reasons+huge-unallocated = UNEXPLAINED, honest split = explained, legacy single reason = explained). All passed.

**Admin preview:** Admin → Cataloguer Activity Timer (**/admin/activity-timer**) has a "👁 Preview the popup" button — read-only replica driven by the configured reasons (✕ + amber "Preview" badge; nothing saved). Component: components/idle-prompt-preview.tsx.

⚠ **The popup markup lives in TWO places:**
1. The REAL popup — inline in app/(app)/tools/cataloguing/auctions/[id]/lot-wizard-tab.tsx (search "How was this time spent?"). Wired to idle detection + the save flow.
2. The preview REPLICA — components/idle-prompt-preview.tsx.

The **chrome** (heading, split sliders, notes) is still duplicated — the real popup is tightly coupled to the wizard's idle refs and save flow, so it was safer to replicate than to refactor the critical cataloguing path. **The reason BUTTONS are no longer duplicated** (2026-08-10): they and the message banner come from **components/idle-reason-picker.tsx**, which both render — don't inline them back.

## ✅ 2026-08-12 — every review finding is now fixed

Last leftovers: catch-up runs are stoppable (the Pause/Stop/progress block was hidden on stage !== "complete", but a catch-up only runs WHEN complete, so it had no controls and withRetry loops for ever on a rate limit — now "(stage !== complete || running)", keep the "|| running"); AI Upgrade and per-lot re-run can no longer overlap (each held its own snapshot of lots and the last to finish wiped the other's results — both functions and both buttons now carry the guard); rerunLot no longer blanks currentDesc (a content-blocked re-run left the lot description-less in state while the catalogue still had one, so it rejoined the "never got a description" banner until reload); and three catch-up sheet fixes — "is it in BC?" is asked before the receipt check, two lots sharing a barcode on the SAME receipt get their own panel instead of vanishing, and a headers-only BC export is accepted (day one of a staged import has nothing in BC).

## ✅ 2026-08-11/12 — decisions taken on the review findings

- **"Continue anyway" is now FINAL** — answeredGapRef records the gap once the log is written and the save no longer re-raises the popup for it. Jordan: accept the answer, unallocated time still shows in the reports. Do NOT restore the re-ask: each pass wrote another set of rows overlapping the first, and allocating the bare minimum never converged, so the lot could not be saved at all.
- **Lunch is no longer exempt from "requires a note"** (Jordan: "why is lunch special it should just work the same as the rest"). The over-65-minute rule used to REPLACE the admin tick; it is now an extra on top.
- **Photo dedupe stays FILENAME-ONLY** (chosen over also comparing size), but a folder that is entirely skipped now carries a loud amber note saying a re-shoot restarting at DSC_0001 looks like a re-upload. Also fixed: already-there plus one failure used to show a red "all failed" banner that was untrue.
- **No alert on a new accident report** — "No alert for now I might add it later". Deliberate, not an oversight. The Hub has NO outbound email (mailboxes only read) and the ntfy alerts fire from the Auction Monitor page in the browser, so either option needs new server-side sending.
- **Sliders felt "really unresponsive" on a tablet** — not a logic fault: a default range thumb is ~16px against the ~44px a finger needs, and the popup scrolls, so a near-miss scrolled the modal. New .idle-slider class in globals.css: 44px hit area, 30px thumb, and touch-action:none so the drag beats the scroll. Keep touch-action.

## 🔎 2026-08-11 — multi-agent code review of the day's work

Three reviewers over First Aid, the activity timer and the pipeline/BC/photo work. **Fixed:** resumeNotRun ran the stages UNSCOPED, so catching up one newly-photographed lot would regenerate every hand-written description added to the sale since the run and, on auto-apply, overwrite them (stage functions now take an optional onlyIds set — never call them unscoped from a catch-up path); deselecting a reason kept its allocation, so the segments could exceed the gap and the leftover guard swallowed the negative, writing time past the end of the gap; the idle-log route capped segments at 12 and UNALLOCATED is appended last, so the leftover was dropped first (now 40); an admin could create a reason keyed UNALLOCATED, which the save gate filters out, so it could never satisfy the gate and the popup would reopen for ever (blocked in the editor and on import); First Aid's honeypot silently binned genuine reports while the page said "Report sent" (now stored and flagged, never discarded), its rate limits refused everyone behind the shared office address and could be tripped deliberately to take the accident book offline, the public photo proxy served whatever content type the uploader claimed (an SVG executed same-origin as the Hub — now nosniff + a safe-type allowlist + sandbox CSP), deleting a first aider left their photo publicly fetchable for ever, and the public page was all-or-nothing on its queries.

**Found, NOT fixed — worth doing:** the "Continue anyway" loop (the popup offers to record leftover time as unallocated, but evaluateIdleGate excludes UNALLOCATED rows and needs half the gap covered, so it re-raises the same popup and writes a second overlapping set of rows; allocate only the minimum and the lot can never be saved); resumeNotRun has no Pause/Stop and no progress; runUpgrade and rerunLot can run concurrently and clobber each other's state; requiresNotes is ignored for LUNCH_BREAK; the catch-up sheet silently drops two lots sharing a barcode under the SAME receipt and reports already-in-BC lots as problems; the photo dedupe shows the red "Nothing was saved" banner when photos were merely deduped and one failed, and matches on filename alone so a re-photographed lot starting again at DSC_0001.JPG is skipped.

## 🐛 2026-08-11 — "the sliders aren't working and there's a red circle"

Reported live by a cataloguer on production. **Not a touch/UI fault — the popup was mathematically unsubmittable.** The sliders stepped in whole minutes (step = 60_000) while allocMissing blocks Save until **every** selected reason has at least 1s. Four reasons against a three-minute gap = no fourth whole minute to give, so that slider could only ever be 0, Save stayed disabled, and its disabled:cursor-not-allowed is the **red circle** the user described. Any gap shorter than (reasons x 1 minute) hit it; a sub-minute gap broke with just two reasons, because step > max leaves a range input with only one reachable value.

Fix: **splitStepMs(totalMs, count) in lib/idle-timer-config.ts** - whole minutes when they fit, otherwise the largest whole-second step that still lets everyone take a share (floor(total/count), floor of 1s). WARNING: **the slider's step and the snap inside setIdleSplit MUST both come from it** - they were independent before, and if they disagree the thumb snaps to a value the slider cannot represent and looks frozen all over again.

WARNING: also fixed a **preview/real divergence that hid this**: the preview used Math.ceil(gapSecs/60)*60*1000 (rounded UP to a whole minute) while the real popup used the raw idleSecs * 1000. The admin preview therefore always had tidy whole minutes and could never reproduce it. The preview now uses the raw value like the popup. Do not let those drift again.

## ⚠⚠ 2026-08-10 — grouped, colour-coded, with an optional message

Jordan: "the UI for this activity timer needs some improving… we also need better symbols for each option… I'd also like an optional message on the top". Shown three layouts, he picked **grouped and colour-coded**.

- **Grouping**: \`IdleReason.group?: string\` (inside the \`reasons\` JSON — **no migration**). The popup groups by that string **in the order groups first appear in the reasons array**, so the admin controls running order by reordering reasons — deliberately no second ordering setting. **Ungrouped reasons render last in one unheaded bucket**, so a config predating the field still shows every button.
- **Groups panel** (added straight after, Jordan: "I dont have anywhere to manage what the groups are called"). ⚠ **There is deliberately NO groups list in the DB** — a group is only the string on each reason, so the two can never disagree about which groups exist. The panel derives the list from the reasons and manages them by editing those reasons underneath: **rename** writes the new name to every reason in the group (blank is refused — it would silently ungroup the lot; renaming onto an existing name merges them, which is the intended way to merge), and **▲▼** calls \`applyGroupOrder\`, which rebuilds the whole reasons array in group order (each group keeping its internal order, ungrouped last) so the admin list ends up matching the popup and any interleaved group is un-interleaved. Rename commits on **blur/Enter, not per keystroke** — live renaming would rewrite every reason as you type and merge two groups the moment one name passed through the other's spelling. The reason modal's group datalist lists **groups already in use first**, so a typo does not quietly create a near-duplicate.
- **Colour is finally used.** Each unselected chip wears its own \`colour\` — already stored per reason and previously ignored (the popup drew plain white cards). Selected overrides with the app teal + ring so "picked" reads across a dozen colours. Safe because \`COLOUR_PRESETS\` is a fixed list in source, so Tailwind generates every class — ⚠ **never let an admin free-type a Tailwind class here**, it would be purged.
- **Why every reason showed 📝**: the admin reason form pre-filled \`useState(initial?.icon ?? "📝")\` and nobody changed it. It now **starts blank** with a grouped emoji **picker** (\`ICON_CHOICES\`) plus a free-type box.
- **✨ One-click fill**: \`suggestReasonMeta(label)\` maps Vectis's real labels (lunch break, palletising, lot corrections/alterations, telephone bidding…) → symbol + group. The button only touches reasons with **no symbol / the old \`PLACEHOLDER_ICON\` / no group** and never overwrites a hand-set value — 16 reasons would otherwise be 16 manual edits.
- **Copy this setup elsewhere — download / upload JSON** (added 2026-08-11 once Jordan had staging how he wanted it: "so I dont have to set it up again on main"). ⚠ He **refused this at first** ("No import export I need to test it before pushing to main") and asked for it only after the setup was finished — the ⬇ Load the full list button was the answer for testing, this is the answer for carrying a finished setup across. Both exist; neither replaces the other. File is \`{version:1, reasons, message}\`; **upload only fills in the editor, nothing is written until Save**, so a wrong file is undone by reloading. ⚠ The import **rebuilds each reason field by field** rather than spreading the file's objects — an unknown key would otherwise land in the reasons JSON and be fed to the popup; \`colour\` must match a real \`COLOUR_PRESETS\` entry (a free string would be purged by Tailwind and render unstyled), \`idleColour\` must be a \`#rrggbb\`, and duplicate keys are dropped with a count, since two reasons sharing a key collide on save.
- **⬇ Load the full list**: \`VECTIS_REASONS\` in lib/idle-timer-config.ts — all 17 reasons with symbols, groups and per-group colours. ⚠ **Staging and production are SEPARATE databases** (confirmed 2026-08-11: staging held only the 6 \`DEFAULT_REASONS\` while production held 16), and \`DEFAULT_REASONS\` only ever seeds an EMPTY table — so a fresh environment cannot be tested against the real list. The button replaces the editor's list in one click, shows only while the list is shorter than the full set, and writes nothing until Save. **Jordan explicitly rejected an export/import for this** ("No import export I need to test it before pushing to main") — do not build one. It is a starting point, not a live mirror; do not wire it into seeding or a sync.
- **⚠ The local \`.env\` DATABASE_URL is PRODUCTION**, not staging — verified by reading \`IdleTimerConfig\` (16 reasons, matching production's screen). Read-only queries from a dev machine hit live production data; never write from there.
- **Optional message**: \`IdleTimerConfig.message\` (**new TEXT column**), edited on /admin/activity-timer, shown in an amber banner above the reasons; **blank = no banner**. ⚠ Every read/write is **migration-safe** (try/catch + fallback) because the code deploys before the column exists.`,
  },
  {
    filename: "terms_aup.md",
    content: `---
name: iPad AUP terms popup — /admin/terms
purpose: The Acceptable Use Policy sign-gate + its admin viewer/preview. Read before touching terms/signing.
last_updated: 2026-07-23
---

# iPad Acceptable Use Policy — terms & signatures

One small system: **lib/terms.ts** is the single source of the policy — \`TERMS\` (sectioned blocks), \`TERMS_TITLE\`, \`TERMS_VERSION\` (\`ipad-aup-2026-07\`). ⚠ Bumping \`TERMS_VERSION\` re-prompts EVERYONE to sign again (acceptances are per version). Edit wording here, not in the popup.

**components/terms-gate.tsx** = the app-wide blocking modal (rendered by app/(app)/layout.tsx only for a signed-in user who hasn't accepted the current version): read → "I accept — sign below" → draw signature → POST /api/terms/accept (stored as a white-composited PNG). Login-adjacent/critical — don't break the non-preview path.

**Admin → Terms & Signatures** (app/(app)/admin/terms/page.tsx, admin-only) shows who signed the current version (name, email, signature image, date) + who's outstanding; "mark signed" records an admin accepting on someone's behalf (\`admin:\` prefix).

**2026-07-23 — Preview the popup:** TermsGate gained a guarded \`preview\` mode (+ \`onClose\`) — shows the identical popup but never saves (submit just closes; ✕ + amber "Preview" badge; subtext says nothing is saved). Opened via components/terms-preview-button.tsx ("👁 Preview the popup"). ⚠ Every preview-only branch is guarded on \`preview\` (default false) so the real sign-gate is unchanged — keep it that way.`,
  },
  {
    filename: "reports_pdf.md",
    content: `---
name: Cataloguing Performance PDF reports — /tools/reports
purpose: The Summary + per-cataloguer PDF exports on the main reports page. Read before touching lib/reports-pdf.ts or /api/reports/pdf.
last_updated: 2026-07-23
---

# Cataloguing Performance reports — PDF export (rebuilt 2026-07-23)

The main /tools/reports (Cataloguing Performance) page has clean, manager-friendly PDF exports, rebuilt 2026-07-23. Jordan wanted them "simple with a clean layout but still full of detail" — this replaced an earlier forensic per-lot dump. Two layouts, one route (app/api/reports/pdf/route.ts), one builder (lib/reports-pdf.ts — pdf-lib, A4 landscape, Vectis logo, same house style as the Activity/idle PDF):

- **Summary (PDF)** button → \`?summary=1&range=\` → buildSummaryPdf: **everything period-scoped** (Jordan rejected "today"/"week" columns inside a 30-day report). Team stat boxes (Total Lots · Avg Time/Lot · Cataloguing Time · Total Time Away) + a ranked league table (Lots · Share % · Active Days · Avg/Day · Avg/Fastest/Slowest · Away · Away % · Research) with output bars + Team Total row, then **team-wide breakdowns**: by auction, time away by reason, and daily output across the period.
- **Export all (PDF)** button → \`?range=\` → buildIndividualsPdf: one clean page PER cataloguer.
- Clicking a name / per-row PDF / the individual page's Export → \`?userId=&range=\` (or \`&from=&to=\`) → same buildIndividualsPdf, one person.

Each individual page: stat boxes → cataloguing-vs-away bar → speed & method (incl. key points + research) → by-auction → away-by-reason → per-day breakdown. No per-lot line dump.

⚠ Numbers mirror the on-screen page maths exactly (orphan-log exclusion via buildLotMap, ReportExcludedDay day-exclusions, timed-only averages, rolling-7-day "this week" via ukDayStartUtc(now,7), 10h away cap). Keep the route aggregation in step with app/(app)/tools/reports/page.tsx so figures don't drift. Research-only users are included (userIds unioned from timing + idle + research).`,
  },
  {
    filename: "compliance_page.md",
    content: `---
name: Data & Compliance page — /admin/compliance
purpose: The static internal UK data-protection note. Keep its lists in sync when integrations change.
last_updated: 2026-07-23
---

# Admin → Data & Compliance (/admin/compliance) — added 2026-07-23

A static, admin-only, plain-English internal note (app/(app)/admin/compliance/page.tsx) for handing to a solicitor / data-protection adviser — built after Jordan asked about "legal stuff for registering the software / giving it to staff". Framing is UK GDPR / ICO (Vectis is a UK auction house). Has a prominent "NOT legal advice — internal working note" disclaimer.

It lists: what personal data the Hub holds (customers, bidders, staff accounts + monitoring, financial); the STAFF-MONITORING features (cataloguing activity, away popup, Unaccounted Time, device clock/timezone tamper detection, lot change log) flagged RED as the priority (DPIA + transparency likely needed); where data lives (Neon Postgres / Cloudflare R2 / Railway); third parties data is shared with (Google Gemini, Microsoft/Business Central, Royal Mail Click & Drop, D-ID, GA4, ntfy.sh); and points to raise (employee monitoring, ICO data-protection fee, privacy notice, retention + 72h breach notice, PCI/no full card numbers, third-party ToS + OSS licences).

⚠ KEEP IT IN SYNC: when the Hub gains a NEW third-party integration, data store, or staff-monitoring feature, update the STORES / PROCESSORS / MONITORING arrays in that page. Linked from the Admin overview grid ("System & AI", ⚖️ icon).

## DPIA page (/admin/dpia) — added 2026-07-29

**Admin → DPIA** (app/(app)/admin/dpia/page.tsx, admin-only, 🛡️ icon, linked from the admin grid AND cross-linked from the compliance page). A **Data Protection Impact Assessment** following the **ICO DPIA template** (UK GDPR Art. 35), built when Jordan asked for "a DPIA for the system". Same house style + "NOT legal advice, working DRAFT" framing. Steps: 0 document control, 1 need (staff monitoring = trigger), 2 describe processing, 3 consultation, 4 necessity & proportionality (lawful-basis table), 5 risk register (R1–R8, likelihood×severity→Low/Med/High badges), 6 measures (existing vs recommended per risk), 7 sign-off. Identity/DPO/sign-off fields are deliberately "to complete"; company identity pre-filled (Vectis Auctions Ltd, Thornaby TS17 9JZ). R1 (staff monitoring) rated High.

⚠ It DUPLICATES the compliance page's data inventory in its own STORES/PROCESSORS/MONITORING arrays (plus DATA_CATEGORIES/LAWFUL_BASIS/RISKS/MEASURES) — update BOTH pages when integrations/stores/monitoring change.`,
  },
  {
    filename: "dolls_bears_descriptions.md",
    content: `---
name: Dolls & Bears descriptions — tuning
purpose: The recurring model errors, the deterministic clean-up, the "Dolls & Bears check" upgrade mode, and why bold was dropped. Read before touching the Dolls/Bears instruction or batch/upgrade cleanup.
last_updated: 2026-07-22
---

⚠⚠ 2026-08-20 - THE CODE GUARD ACCUSED THE AI OF INVENTING A CODE THAT WAS IN THE KEY POINTS. On F109409 the banner read "Double Check introduced product code Set 65705, which does not appear in the key points" while key point 2 read "wearing Skidoo Set 65705" - and Double Check's whole rewrite was discarded on the strength of it. CAUSE: CODE_RE only recognises a code when 2-4 LETTERS BUTT AGAINST THE DIGITS. Measured across real spellings: "Set 65705", "Set65705", "set 65705" are seen; "Skidoo 65705", "Outfit 65705", "Set #65705", "Set No. 65705", "Set: 65705" and "Daisy, 65705" are NOT - and that last is how the code appeared in that lot's own description. So the guard was blind to the code where the human wrote it, saw it in the stage's tidier version, and called it invented. FIX - AN ASYMMETRY, and the reasoning matters more than the code: STRICT ABOUT ACCUSING (a bare number is still never a code, since a size, year or edition looks like one - CODE_RE unchanged) but GENEROUS ABOUT EXONERATING (digitRuns() collects every 4-9 digit run from the key points and original description; if a new code's digits were already in front of the stage, it did not invent them). Getting it wrong in the ACCUSING direction discards real work and sends a cataloguer to re-check an item for nothing; the other way merely lets an edit through that a human is reviewing anyway. ⚠ NEVER tidy this into one symmetric rule. Regression-tested across six spellings, and the F109109 substitution CB252575 to CB104670 is still caught.

# Dolls & Bears descriptions — tuning (2026-07-21)

The Dolls & Bears presets produce bulleted lot descriptions; the instruction TEXT is DB-managed (Auction AI → Instructions). Instruction-only iteration kept failing the same mechanical mistakes, so the fix is split three ways.

⚠ **Bold was tried and DROPPED.** An earlier version used markdown \`**bold**\` for names, but nothing renders it (the Review tab's HighlightedDescription doesn't parse markdown; website + BC take raw text) so \`**\` showed literally on every lot. Descriptions are PLAIN TEXT — do not reintroduce \`**\`.

Recurring errors:
- Mechanical (fixed in code): literal \`**\`; "LE 6000" not "limited edition 6000"; the "plumo means…" reminder note printed in; the item name repeated after the dash; a stray space in the code ("CB 114790").
- Judgement (need AI/instruction): "x three" (→ "a trio of"); guessing/wrong animal type (a brown bear called a "panda"); thin openings; routine "designed by [name]"; broken grammar.

Fixes (built 2026-07-21):
1. Deterministic clean-up \`lib/description-cleanup.ts\` \`cleanBearsDescription()\` — strip **, LE→limited edition, remove "plumo means…" AND any plumo expansion ("plumo (plush with mohair and alpaca accents)" → "plumo", buyers know the term), de-dupe repeated name, close "CB 114790". Applied in /api/auction-ai/batch (scoped isBearsPreset), /api/auction-ai/upgrade (dolls_bears_fix mode), and — since 2026-08-19 — the key-points-check and double-check routes as well. NOT the Chat route.

⚠⚠ 2026-08-19 — WHY THE SPACED CODE KEPT COMING BACK. Measured on a live Charlie Bears trio: "Product code CB 165133, 13" 33cm" while the other two bullets were fine. The clean-up ran in Batch only, and the pipeline is Batch → Key Points → Double Check. The Key Points stage's whole job is to restore the cataloguer's exact wording — and the cataloguer writes the code SPACED — so it put the space straight back and nothing cleaned up behind it. Both later routes now take an optional presetKey (scoped with isBearsPreset, same as batch) and clean their revised text.
⚠ It must run AFTER auditCodes, never before: the audit's repair puts the cataloguer's spelling back with a literal string replace, so cleaning first would reintroduce the very space it just closed. findProductCodes normalises "CB 252575" ≡ "CB252575", so cleaning cannot make the audit cry "invented code". cleanBearsDescription is idempotent, so re-running after Batch is harmless.
⚠ Joining the code does NOT turn the Review tab red — numberPattern deliberately has no leading \b so "151518" is findable inside "CB151518" (the 2026-08-14 fix; verified still present before shipping).
⚠ ONLY the four call sites that HAVE a preset are covered: the Auto Pipeline tab, lib/pipeline-runner.ts (overnight), and the Instructions Testing tab. The STANDALONE Key Points Check and Double Check tabs have no instruction preset at all (the KP tab's "Key Points Check" string is a saved-run label, not an instruction key), so ad-hoc runs from those two still leave the spaced code. If that ever matters the signal is CatalogueAuction.auctionType (BEARS/DOLLS), not a second scoping mechanism.

2026-08-19 — NEW AI UPGRADE MODE "Fix brand capitalisation" (brand_caps). Jordan: "Can I have another option on here that fixes capitalization and branding so for example Marvel and not marvel or DC instead of Dc". Added as its OWN mode rather than folded into "Standardise format", which mentions capitalisation but means bullet/spacing consistency - a different job. TWO PLACES THAT MUST STAY IN STEP: UPGRADE_MODES in app/(app)/tools/auction-ai/page.tsx (the tickbox - the single source shared by the standalone AI Upgrade tab AND the pipeline's inline upgrade step, so one entry covers both) and MODE_INSTRUCTIONS in app/api/auction-ai/upgrade/route.ts (what the model receives). ⚠ Keys must match EXACTLY or the tickbox silently does nothing - the route filters on MODE_INSTRUCTIONS[m]. Verified after the change that all 13 UI modes resolve to an instruction. The instruction is deliberately narrow: acronyms in full capitals (DC, BBC), ordinary names in title case, and NOTHING else changed - not the wording, word order, punctuation or line breaks, and explicitly NEVER a product/catalogue code, white tag number, edition number or measurement whatever its case (CB165133, 670442A, 13"/33cm); no Title Casing whole sentences, no capitalising ordinary words, and never introducing a brand that is not already in the text. ⚠ That last guard matters - a capitalisation pass is exactly the sort of thing that quietly "corrects" a cataloguer's product code, the fault lib/product-codes.ts exists to prevent, and the upgrade route has NO auditCodes guard of its own, so the prompt is the only protection there.

⚠ Keep the instruction LEAN (Jordan): the prompt goes in on every lot, so verbosity raises cost AND makes the model follow fewer rules. Slimmed to ~40% (judgement/format/estimate only); mechanical rules live in the clean-up. Applies to AI prompts generally.
2. Instruction tightening for the judgement calls.

⚠⚠ 2026-08-19 SECOND PASS — THE MAKER IS THE FIRST WORD OF THE OPENING. Tested on F109035 (Merrythought, two bears + a golly) in the Instructions Testing tab. Batch opened "A trio of Merrythought teddy bears and a golly." I reported the COUNT as the fault; Jordan corrected me — Double Check already fixes the count, the real fault is that it does not start with the brand. He was right and I had the priority wrong. Root cause: LAYOUT said "Start with the maker" but the OPENING section never repeated it and NO EXAMPLE DEMONSTRATED IT, so the rule was quietly dropped — a rule stated once, in a different section from the examples, does not survive. Double Check makes the minimum change and was never told about maker-first, so this must be got right in Batch. The OPENING block now leads with "THE MAKER IS THE FIRST WORD. Always.", lists the forbidden openers ("A trio"/"A pair"/"A collection"/"A lot"/"Lot") with a rewrite instruction, covers mixed-maker lots, and BOTH examples start with the maker.
Three more folded in from the same lot: the EDITION may not open a bullet (lead with what the item IS, edition woven in after); the NEGATIVE may not restate the positive ("(fraying to ends)" once the ribbon is described, not "(fraying to ends of pink ribbon around neck)"); and the FLAG line is ONLY for a suspected KEY-POINT mistake — the KP stage had used it to complain about the AI's own opening sentence, which in a real run writes an aiFlagNote and puts an amber Review-tab banner in front of the cataloguer about a fault that is not theirs.
Left alone as a judgement call: the model added brown coat / cream and gold striped ribbon / "cloth label to the foot" / red waistcoat / yellow trousers when the key points said only "mohair", "mohair", "felt" — permitted by "plainly visible in the photos", but a cloth label to the foot is a known Merrythought identifying feature and reads more like recall than sight.
3. New "🧸 Dolls & Bears check" AI Upgrade mode (dolls_bears_fix) — an AI pass over EXISTING descriptions fixing both, plus the clean-up. In the AI Upgrade tab and the pipeline's upgrade step.

## 2026-07-22 — descriptive-sentence restyle + KP strict/relaxed mode

1. Instruction restyled to flowing sentences (modelled on onemorebear.co.uk): bullets KEPT, but each "• Name – " is now one or two descriptive sentences (measured auction tone — no gushing, no invented backstory, no he/she unless in key points), ending "Product code X, 16"/41cm." Edition woven in as "a limited edition of 6,000". Jordan pastes it into Auction AI → Instructions; still in the test loop.
2. Root cause the restyle exposed: the Key Points stage was UNDOING the flowing style — KEY_POINTS_INSTRUCTION (lib/key-points-instruction.ts) replaces approximate phrasing with the cataloguer's exact wording, crunching sentences back to telegraphic fragments.
3. Built strict/relaxed KP mode: new KEY_POINTS_INSTRUCTION_RELAXED (same file, same JSON contract) lets the checker reword key-point FACTS to fit the sentences; names/codes/editions/sizes stay character-exact; layout/bullets preserved. /api/auction-ai/key-points-check takes mode "strict"|"relaxed" (absent = strict = old behaviour). Tickboxes on BOTH the KP Check tab (localStorage kp_check_relaxed) and the Auto Pipeline options row (pipeline_kp_relaxed). The instruction viewers (pipeline ShowInstructionToggle + KP tab HowItWorksPanel) show the ACTIVE variant — the stale hardcoded KP_SYSTEM_PROMPT display copy was deleted.
4. Per-auction Review tab matching mode — ⚠ the Review tab is the HUMAN check on the AI; it must NEVER auto-trust the AI's own KP verdict (that idea was proposed and REJECTED). CatalogueAuction.reviewKpMode "strict"|"relaxed" (default strict, NEEDS Run Migrations), chosen in Auction Settings ("Exact wording (e.g. trains)" / "Relaxed wording (e.g. Dolls & Bears)"). analyseKeyPoints (lib/kp-analysis.tsx) gained a mode param + a "reworded" status: relaxed holds the digit-bearing hard tokens (sizes/editions/codes — which the relaxed AI instruction forbids rewording) to an exact match; all present but wording different → amber "reworded — check wording" (still an issue, human reads it); any hard token absent → red "not found". Strict = old behaviour except two accuracy fixes in both modes: unit equivalence (13 inches ≡ 13", N cm ≡ Ncm — normalised on the key-point side only, never the description) and exact numbers ("250" no longer false-passes on "2500" or on the tail of "1,250"; 1,500 ≡ 1500 both ways; 13-inch/34cms tolerated). ⚠ Matcher traps (adversarial-reviewed + regression-tested): a spaced bare "in" after a number is the PREPOSITION ("24 in the set") and must never be fused into an inches token; comma-grouped KP numbers are de-comma'd key-point side before tokenising; NO regex lookbehind (old Safari on the shared iPads throws at compile time). Only the Review tab passes a mode; the AI Upgrade tab call site stays strict.

## WARNING: "relaxed key points doesn't work at all" was a \\b in numberPattern (2026-08-14)

Jordan's example, F109060, a pair of Charlie Bears. Key points: "Kirk, CB 151518, plush, swing labels, 16 inch/41cm." Description: "...complete with swing labels. Product code CB151518, 16 inch/41cm." Every fact was present, and it still showed a red "2 key points not found".

Cause: the cataloguer writes the product code SPACED (CB 151518) and the AI writes it JOINED (CB151518). hardTokens and significantWords split on the space, so the token is the bare number 151518 — and numberPattern began with a word boundary, which CANNOT match between "B" and "1" because both are word characters. The hard token therefore counted as absent and went red, on every Charlie Bears lot, which is exactly the kind of sale relaxed mode exists for. hardTokenRegex had anticipated the mirror case (key point joined, description spaced) but that branch never fires when it is the key point that carries the space.

Fix: NO leading word boundary in numberPattern. The only thing it was protecting against is a DIGIT immediately before the match, which startsInsideNumber now checks (it replaces falseNumberTail and still catches the "250 inside 1,250" comma case). Letters before a number are legitimate — that is a product code. Verified: 151518 matches CB151518; does not match inside 9151518; 250 does not match the tail of 1,250 nor the front of 2500; 16 does not match the tail of CB151516; 41cm and 6,000 unchanged.

WARNING: this sits in the SHARED number matcher, so it fixed strict mode as well as relaxed — do not assume a key-point matching bug is confined to one mode.

## Then the big one: the full stop was a SEPARATOR, so every decimal size failed

Measured over the whole F109 sale — 435 lots that have both key points and a description, pulled from /api/auction-ai/catalogue-lots and run through the matcher in the browser: **130 lots had a failing key point, and 137 of the 160 failures were a single shape.** All decimals. Key point "14.5 inch/37cm", description "14.5 inch/37cm", identical text, still red.

Cause: tokenising split on the full stop, so "14.5in" became "14" and "5in". The bare "5" then did match inside "14.5" in the description — and was rejected by the very guard that stops "250" matching inside "1,250", because that guard treats a comma OR a full stop with a digit before it as "inside a bigger number". So a decimal size could never pass, in either mode.

Fixes, all in lib/kp-analysis.tsx:
- The full stop is now a TOKEN character (TOKEN_SPLIT), stripped only from the ends (trimEdges), so "14.5in" survives as one token while a sentence's closing full stop still goes.
- The inches and metric branches of BOTH wordRegex and hardTokenRegex accept decimals, plus a decimal branch for a bare "14.5".
- hardTokenRegex's fallback drops its leading word boundary when the token starts with a digit — "202054a", from a key point written "CB 202054A", has to be findable inside "CB202054A".
- normaliseUnits splits a fused size: the cataloguer typed 13"33cm with no slash, which fused into one token nothing could match. Only the slash in 9"/23cm was saving the ordinary case.

Result on the same 435 lots: **130 lots down to 8, and 160 failing key points down to 8.** The remaining 8 are genuine — the digits really are absent from the description, and one has the AI writing white tag 670442 where the key point says 670446, which is exactly what the check exists to catch.

## WARNING: DOUBLE CHECK was overwriting the cataloguer's product codes (2026-08-14)

WARNING — read the results columns correctly before blaming a stage. In the pipeline results table, "Fixed" followed by the contradictions text is DOUBLE CHECK (dcStatus === "issues"), and "Accepted" followed by the kpAdded text is KEY POINTS (kpStatus === "fixed"). See dcCell and kpCell in the Auto Pipeline tab. Claude read them the other way round from a screenshot and blamed the wrong stage; Jordan caught it.

On F109109 the DOUBLE CHECK stage replaced the cataloguer's CB252575 with CB104670, reporting "the tags in the photo clearly identify it as 'Scribbles 2010 Signing Bear'". Key Points behaved impeccably on that same lot — it corrected the code spacing and inserted LE 2500 exactly.

WARNING: Double Check DOES receive the photos. Its route takes images plus the key points and returns a rewritten description. So unlike the Key Points stage it was not inventing evidence — it really did read the swing tag. It was still wrong: CB252575 is the 2010 Anniversary edition, and the cataloguer had it right. Reading a tag in a photograph is not grounds to overwrite the person who held the item.

The guard now lives in the Double Check route as well, so the browser run and the overnight runner both inherit it. One code introduced against one removed puts the cataloguer's spelling back and keeps the rest of the rewrite; anything murkier drops the rewrite; either way an aiFlagNote records "Double Check read the photo as X, but the key points record Y — check it against the item, and correct the key points if the photo is right."

## The same guard on the KEY POINTS stage (2026-08-14)

F109109, a Charlie Bears trio. The Batch stage produced the correct CB252575. The KEY POINTS stage then replaced it with CB104670 and recorded itself as Fixed, explaining: "the tags in the photo clearly identify it as 'Scribbles 2010 Signing Bear'". The cataloguer was right — CB252575 is the 2010 Anniversary edition; CB104670 is the ordinary Scribbles.

WARNING: that stage is TEXT-ONLY. /api/auction-ai/key-points-check is sent {label, keyPoints, description, model, mode} and NO images whatsoever. It fabricated the photographic evidence to justify a code it recognised from training data. Its instruction already said product codes are "sacred — copy them character-for-character from the key points". It did it anyway. That is precisely why the fix belongs in code and not in more prompt text.

The invariant that makes it checkable: a stage which may only insert facts from the key points, and which cannot see anything, has no possible source for a product code that appears in neither the description it was given nor the key points. lib/product-codes.ts auditCodes() enforces it inside the ROUTE, so the browser run and the overnight runner both inherit it:
- exactly one code invented and exactly one REMOVED — an unambiguous substitution — puts the cataloguer's own spelling back and keeps the rest of the edit;
- anything less clear-cut drops the whole edit, because an edit that invented a code has not earned the benefit of the doubt;
- either way an aiFlagNote is written, so it surfaces in the Review tab as an amber warning.

WARNING — Jordan's explicit call: FLAG it as a possible cataloguer mistake, NEVER let the pipeline overwrite the cataloguer's code. Both key-point instructions gained a "flag" field in their JSON contract as the sanctioned way to say "I think this is wrong", plus an explicit "YOU CANNOT SEE ANY PHOTOGRAPHS" rule.

WARNING — two traps found only by testing against the real lot, each of which broke the repair:
1. "LE 2500" parses as a product code (two letters plus four digits) and appears in nearly every bears key point. Counted as a code it made a second entry look lost, turning a clean one-for-one substitution into an "ambiguous" case that threw the good edit away. NOT_A_CODE_PREFIX excludes LE, NO, LOT, EST and REF.
2. "Lost" has to mean REMOVED from the description, not merely absent from it. A key-point code the description never carried is just a missing fact, which is the stage's ordinary business.

## The verdict now NAMES the part (2026-08-14)

Jordan: "Are we able to improve it so instead of just saying not found it says exactly which part?" KpMatch gained **missing: string[]** — the exact tokens that could not be found — and the Review tab prints them: "not found: 670446", "reworded — wording differs on: ...", "partly worded — missing: ...". describeToken turns a token back into the cataloguer's own spelling (our internal 15in becomes 15", a lower-cased code becomes CB125094).

Why it matters: one key point line can carry four bears. F109305's single line covers all four Steiff seasons, and the AI wrote white tag 670466 where the cataloguer had 670446 — one transposed digit, turning the whole line red with nothing to say which of the four was wrong.

WARNING — method worth reusing: do not debug a matcher one lot at a time. Pull the whole sale from /api/auction-ai/catalogue-lots?code=, run the old and the new matcher over every lot, and tally the failures BY TOKEN SHAPE (replace digit runs with #). The dominant shape is the bug, and the before/after tally is the proof.`,
  },
  {
    filename: "idle_report.md",
    content: `---
name: Idle Report — /tools/reports/activity
purpose: The team-wide idle report page (for non-technical managers). What it shows + data sources + PDF export. Read before touching it or the reports section.
last_updated: 2026-07-22
---

# Cataloguer Activity Report — /tools/reports/activity (2026-07-21)

Team-wide activity report in the cataloguing reports section — a new page, linked from the /tools/reports overview via the amber "⏱ Activity Report" button. REPORTS access.

⚠ NAMING: "idle" is banned in user-facing text (implies doing nothing). UI says "Cataloguer Activity"; the time metric = "Away / time away" (labels renamed 2026-07-21; popup heading softened to "How was this time spent?" 2026-07-23). **Page URLs de-idled 2026-07-23**: /tools/reports/activity, /admin/activity-timer, /admin/unaccounted-time — old idle URLs kept as redirect stubs. Code identifiers, DB tables (IdleLog/IdleGateDecision) and API routes (/api/reports/idle/pdf etc.) STILL use "idle" — do NOT change those.

⚠ Written for non-technical MANAGERS — plain English, no dev jargon. Jordan rejected the first version's technical/empty cards. Keep language plain and keep it feature-rich.

- Page: app/(app)/tools/reports/activity/page.tsx (server) + idle-report-charts.tsx (client, recharts). Time-range pills via ?range.
- Cards: Total Time Away · Away Share of Day (% of 9–5) · Away per Person/Day · Most Common Reason.
- Idle by reason: bar chart + numbers table (total, times, avg, share %). When idle happens: by day-of-week + by time-of-day charts. Idle-over-time trend.
- Per-cataloguer table (ranked): idle, per-day, Share of Day (amber ≥15% / red ≥25%), breaks, usual reason, "No Reason Given" (= unexplained gaps, plain-worded), Busiest Idle Day; links to /tools/reports/[userId]; "timer off" badge.
- Longest single breaks table.
- ⚠ Flagged for review — ADMIN-ONLY clock-tamper table (server time vs what the device showed + tz).

Data: IdleLog (reasons), CatalogueTimingLog (orphan-excluded) → findUserGaps, IdleGateDecision (tamper, tolerated absent pre-migration), reasons from idleTimerConfig. Days worked = distinct person+London-day with a save. Only Mon–Fri 9–5 counts.

## 2026-07-22 — shared aggregation + PDF export
- All figures now computed by computeIdleReport(range, includeTamper) in lib/idle-report.ts (also RANGES/resolveRange/rangeStart/fmtDuration/WORK_DAY_MS). The page and the PDF both call it so numbers can't drift; the page is a thin renderer (userRows carry pre-derived perDay/pctDay/topReasonKey/busiest/timerOff). includeTamper gates the admin-only tamper rows server-side.
- PDF export: red "⬇ Export PDF" button by the range pills (only when hasData) → GET /api/reports/idle/pdf?range=X (download). Builder = buildIdleReportPdf in lib/idle-report-pdf.ts (split from the route so it's testable). A4 landscape pdf-lib, logo header, 4 stat boxes, reason table (swatch + share bars), per-cataloguer table (auto page-break, header redrawn per page), longest-breaks, admin-only tamper table, footer page numbers. ⚠ Reason icons are EMOJI → can't embed in WinAnsi PDF font, so the PDF uses colour SWATCHES not icons; all text via safeAscii.`,
  },
  {
    filename: "scan_timer_split.md",
    content: `---
name: Scan timer split — blue lot timer vs away prompt
purpose: The lot-wizard blue count-up timer is now a separate per-user toggle from the away/activity prompt. Read before touching the lot-wizard timer or idle gate.
last_updated: 2026-07-22
---

# Scan timer split (2026-07-22) — NEEDS RUN MIGRATIONS

The lot wizard (lot-wizard-tab.tsx, shared desktop + tablet) had ONE setting, User.showScanTimer, gating BOTH the little blue count-up timer AND the away/activity prompt ("what were you doing?" after a long gap). Jordan wanted them separate, the blue timer off by default, and it was "triggering before the barcode was entered".

Split:
- User.showScanTimer (default true) → now controls ONLY the away/activity prompt (checkIdleOnLotStart / maybePromptIdleBeforeSave / checkWithinLotIdle / visibilitychange). Admin label reworded to "Away / activity prompt".
- User.showLotTimer (NEW, default FALSE, NEEDS Run Migrations) → controls ONLY the blue count-up timer. New admin tickbox "Lot make timer (blue)". New column ⇒ every existing user is off automatically, no backfill.
- Both toggles are admin-only on the Users page (edit-user-form.tsx → PUT /api/admin/users/[id]/settings). No self-service settings page. timerRedMins still does double duty (blue timer red threshold + away-prompt gap) and shows when either toggle is on.

Premature-trigger fix: the blue timer used to start in startLotTiming() which fires on the barcode field onFocus (auto-focused on step 2), so it counted before a barcode was entered. Now the blue timer counts from a SEPARATE ref lotTimerStartedAt, set by startLotTimerDisplay() on the first actual barcode character (onChange) + "Next Barcode Number" — never on bare focus; reset on save AND in changeVendor() (stops on step 1). ⚠ barcodeStartedAt (the activity + save durationMs baseline) is STILL set on focus — do NOT move it, scanner-injected barcodes with no keystroke depend on it. Prop flows: cataloguing + tablet page.tsx (select showLotTimer) → auction-tabs / tablet-tabs → LotWizardTab. auth.ts uses an explicit select so the new column can't lock login out pre-migration.`,
  },
  {
    filename: "idle_timer_mobile_bypass.md",
    content: `---
name: Mobile idle-timer dodge — investigation + fix
purpose: How a phone user dodges the idle timer, what was ruled out, and the server-time + decision-log fix. Read before touching idle detection / the scan timer.
last_updated: 2026-07-21
---

# Mobile idle-timer dodge — investigation + fix (2026-07-21) — NEEDS RUN MIGRATIONS

A cataloguer on a mobile phone keeps dodging the idle timer. Cataloguers work on PRODUCTION; Jordan reviews on staging.

## Ruled OUT (don't re-propose)
- Photo Only path — nobody uses it.
- durationMs=0 / "no timing log" starved gate — WRONG: he HAS timing logs (counted in /tools/reports AND shows on /admin/unaccounted-time).
- Per-user config — his scan timer is ON, 30-min threshold.
- "Everyone has unexplained gaps", not just him — the report alone can't single him out.
- Production running an older gate — it is a bit behind staging, but Jordan says that's not the issue.

## Confirmed vector
The on-screen popup works out "is it 9–5" from the PHONE's clock. He's believed to set the phone to a US timezone / 2am so the popup thinks it's outside working hours and never nags him. The SERVER save-block already uses the server clock (immune), so the clock trick shouldn't let him actually create lots across a real gap — the exact remaining leak wasn't provable from code, so we added a log to catch it.

## Built (STAGING; Jordan merges to prod out of hours)
- lib/idle-gate.ts evaluateIdleGate() — one server-authoritative decision (server clock + Europe/London working hours + DB save times) shared by the create-lot gate AND /api/catalogue/last-activity (the popup). So the phone clock/timezone can't silence the popup any more.
- Client checkIdleOnLotStart uses the server's shouldPrompt when online; device time only as an offline fallback.
- IdleGateDecision table (NEEDS Run Migrations): createLot logs each meaningful save's decision + what the DEVICE claimed (clientNow, clientTz) + userAgent. Admin viewer on /admin/unaccounted-time ("Save-time gate decisions") flags any save whose clientTz ≠ Europe/London or clock >10 min off server — the smoking gun. Logging is best-effort (never breaks a save).
- Gate hardening: a covering idle log must cover ≥ half the gap to clear; the ">=8h day off" skip only applies across a real day boundary.
- (Earlier same-day pass, still valid: createLot always writes the timing log; timer starts on barcode onFocus; reports ignore durationMs=0 for speed.)

The decision log is the point: once on production it will show exactly what his phone reports at each save.

## ⚠ Within-lot checks are server-confirmed too (added 2026-08-07 — the Kathy false "2h away" popup)

Kathy Taylor got a "2h+ away" popup at 16:52 on 2026-08-06 while saving lots every few minutes. Production data proved no server involvement (no IdleGateDecision block, no IdleLog at that time) — the popup came from a **stale page instance** (second device/tab with the sale open mid-lot): the two WITHIN-LOT checks in lot-wizard-tab.tsx (\`checkWithinLotIdle\`, \`maybePromptIdleBeforeSave\`) measured "how long since THIS PAGE was touched" from in-memory refs, blind to work in another tab (the wizard stays **mounted-hidden** on tab switch in both auction-tabs and tablet-tabs), another device, or the native camera. Refresh clears it because the refs die with the page — **a popup with no matching IdleGateDecision/IdleLog row is a device-local false positive.**

Fix: same pattern checkIdleOnLotStart always had — the local measure only decides WHEN to ask; \`confirmIdleWithServer()\` hits /api/catalogue/last-activity (→ evaluateIdleGate) and the popup opens only on "prompt", using the SERVER's figures. "fine" → re-baseline (the save path clears pendingSaveRef and resumes performSave itself). Offline → old device-local behaviour (create-lot gate still backstops). **Never raise the within-lot popup from local refs alone again.** The Resume (draft) button is safe by design — timing starts fresh + it runs the server-based lot-start check.`,
  },
  {
    filename: "report_day_exclusion.md",
    content: `---
name: Exclude days from a cataloguer's report — report-only, admin
purpose: How admins hide odd/half days from a report so they don't skew the average. Read before touching the reports tool.
last_updated: 2026-07-22
---

# Exclude days from a cataloguer's report (2026-07-21) — NEEDS RUN MIGRATIONS

Admins can hide a single working day from ONE cataloguer's performance report so an odd/half day (e.g. only 6 lots) doesn't wreck their Daily Average. Report-only — the underlying CatalogueTimingLog/IdleLog rows are never touched, and any day can be restored.

- **Where:** the ✕ Exclude / ↩ Restore button on each row of the **Daily Breakdown** table (DailyComparisonTable in collapsible-sections.tsx, consumed by /tools/reports/[userId]). Admins only (role === "ADMIN"). Non-admins see excluded rows greyed with an "excluded" badge, no button.
- **Storage:** ReportExcludedDay table — userId, day ("YYYY-MM-DD" London key), excludedBy…, unique (userId, day). NEEDS Run Migrations.
- **Action:** lib/actions/reports.ts → toggleReportExcludedDay(userId, day). ADMIN-gated, returns {ok,error} (never throws).
- **Effect — dropped from EVERY figure, in BOTH places:** the individual page filters logs to an "included" set for all stats/cards/splits/detail tables (the Daily Breakdown keeps the full set, tagging each day excluded, so the row stays visible with a Restore button; chart + header totals use included only); the overview list Daily-Avg column + charts add \`AND NOT EXISTS (ReportExcludedDay …)\` to their SQL. Deploy-skew-safe: the SQL clause is gated on to_regclass so it no-ops before Run Migrations, and the individual fetch is .catch(() => []).
- **NOT changed:** the Excel export — still raw per-day data.

## Excluding a WHOLE cataloguer (built 2026-07-27) — NEEDS RUN MIGRATIONS

Same idea one level up, for people who aren't really cataloguers (a test account, someone who saved a single lot once) and would otherwise clutter the league table and drag the team averages. Jordan's ask: "a way of excluding users like Jack and Emma".

- **Storage:** \`ReportExcludedUser\` — \`userId\` (primary key), \`excludedById/Name\`, \`excludedAt\`.
- **Action:** \`lib/actions/reports.ts\` → \`toggleReportExcludedUser(userId)\`, ADMIN-gated, returns \`{ok,error}\`.
- **Where:** \`✕ Hide\` on each row of the Per Cataloguer table (admin-only extra column) via \`app/(app)/tools/reports/exclude-user-button.tsx\`, plus a **"Hidden from reports (N)"** panel under the table with \`↺ Restore\` and who hid them.
- **Effect:** dropped from the per-user SQL, the research SQL, the monthly-buckets SQL, the charts **and the team totals** — the point is that a one-lot account shouldn't move the averages. Also filtered out of the **team PDF** (\`/api/reports/pdf\` without \`userId\`) so the export matches the screen; one person's PDF by id still works.
- **Deploy-skew-safe** the same way: \`to_regclass('"ReportExcludedUser"')\` gates the \`Prisma.sql\` fragments, PDF route uses \`.catch(() => [])\`.

## ⚠ Research-only cataloguers 404'd the detail page (fixed 2026-07-22)
/tools/reports/[userId]/page.tsx keyed the display name AND its notFound() off a timing log (\`anyLog = catalogueTimingLog.findFirst({where:{userId}}); if (!anyLog) notFound()\`). But the overview list unions timing-log AND research-log users, so someone with ResearchLog rows but zero CatalogueTimingLog appeared in the list and 404'd when clicked. Fix: resolve userName from the User record (user.findUnique) with fallbacks to rawLogs/researchLogs/idleLogs[0].userName, and only notFound() when the name is genuinely unresolvable (bad URL) — never on "no lots in range". Don't reintroduce the timing-log-only gate. It surfaced right after a prod deploy so it looked like deploy skew, but was a real latent bug (a hard refresh did NOT clear it).`,
  },
  {
    filename: "idle_gaps_detector.md",
    content: `---
name: Idle-gap detector — tamper-proof backstop to the idle popup
purpose: /admin/unaccounted-time (was /admin/idle-gaps, renamed 2026-07-23) unexplained-gap report. Read before touching idle detection.
last_updated: 2026-07-20
---

# Unexplained idle gaps — server-side detector (2026-07-20)

Built after a cataloguer had a ~4h working-hours gap between lot saves with zero idle logs — the client idle popup was being circumvented. The exact client mechanism couldn't be pinned from the data, so the fix is a tamper-proof server-side backstop (Jordan's call: detector now, harden the client after).

- **lib/idle-gaps.ts** — pure detector: working-hours gaps between consecutive lot saves over the user's own threshold, each marked explained (a matching idle reason was logged) or not. Skips gaps of a full working day+ (days off).
- **/admin/unaccounted-time** (URL renamed 2026-07-23; /admin/idle-gaps redirects) — ADMIN-ONLY full-width report. Date range, groups by cataloguer, flags unexplained gaps, shows a scan-timer-OFF badge. Reads the save history directly, so it catches the gap however the in-app popup was avoided. Linked from Admin → Cataloguer Activity Timer (/admin/activity-timer) + its own Admin card. Multi-select popup answers write several sequential IdleLog rows per gap — fine: coveringIdle SUMS logs in the window.
- The popup itself has no dismiss button — it can't be closed without logging a reason.

## Server-side gate (2026-07-20 — the real fix)
The bypass was closing the app / signing out / reloading, which resets the client's idle baseline. Fix: enforce the gate SERVER-SIDE in createLot. If a cataloguer's next lot comes after a working-hours gap over their own threshold with no idle reason logged, the server refuses to create it and the app shows the popup — once they log the reason it saves. Because it reads the save history, closing/reopening/logout can't get around it. The FIRST lot of the day gets a 30-minute start-of-day grace (a normal ~9–9:30 start is fine); go past it and it gates, showing the idle spanning from the last save so an early finish yesterday shows alongside a late start today. Any logged reason (Holiday included) counts as accounted-for. Working hours are computed in Europe/London server-side (Railway is UTC); the report and gate share one function (assessGap).

⚠⚠ 2026-08-19 — THE REPORT RENDERS ON THE SERVER, SO EVERY TIME WAS AN HOUR OUT IN BST. The report showed a gap of 10:48 -> 12:13; the cataloguing lot list showed the same two saves at 11:48:35 and 13:13:28. /admin/unaccounted-time/page.tsx is a SERVER component, so bare toLocaleTimeString / toLocaleDateString / new Date("...T00:00:00") all run on RAILWAY, WHOSE CLOCK IS UTC - not in the reader's browser. Three separate omissions, all fixed: hm() (the GAP column) had no timeZone, so every time read an hour early through British Summer Time; the DAY column had no timeZone, so a late-evening gap could print the wrong day; and localDayStart/localDayEnd parsed the picker value with no zone while ymd() used getFullYear/getMonth/getDate, so the selected day ran 01:00-00:59 London instead of midnight to midnight. ⚠ The "Save-time gate decisions" panel on the SAME page always passed Europe/London, so the two halves contradicted each other on one screen - which is what made it findable. New helper londonInstant(dateStr, time) reads the wall clock as UTC, asks what London calls that instant and takes the difference back off, so it is correct either side of the March/October changeover (verified against both a BST and a GMT date); ymd now uses toLocaleDateString("en-CA", { timeZone: "Europe/London" }). RULE for this page and any other server-rendered report: EVERY date format must name Europe/London explicitly - a bare toLocale* in a server component is always a bug here.

⚠⚠ 2026-08-19 — WHY A REAL 85-MINUTE ABSENCE PRODUCED NO POPUP: THE TAP DEFUSES THE CHECK. Same lot. The gate was not at fault and NEITHER WAS THE CATALOGUER. CatalogueTimingLog records that lot's OWN duration as 1h 24m. The save-time gate measures from the last save to the moment the lot was STARTED, so it saw about a minute and correctly said UNDER_THRESHOLD - as far as it knows she was on a lot the whole time. The only check that could have caught it is the WITHIN-LOT one, and checkWithinLotIdle (lot-wizard-tab.tsx) is reached from exactly two places: visibilitychange (returning to a backgrounded tab or unlocked screen) and onKeyDownCapture on the wizard root. THERE IS NO TIMER - it never fires on its own. Meanwhile the wizard root wires the other two capture handlers as BARE RESETS: onPointerDownCapture={noteInteraction} and onChangeCapture={noteInteraction}. So on a tablet, where the first thing you do on returning is TAP, noteInteraction() silently resets lastInteractionRef to now and the absence is erased before any check can see it. Nothing was ever asked, so "Unexplained" on the report is unanswerable rather than suspicious.
PROPOSED FIX, NOT APPLIED - ⚠ JACK OWNS THE WIZARD IDLE CODE: have pointer-down and change run checkWithinLotIdle() before noteInteraction(), exactly as keydown does. The asymmetry was presumably guarding against stray touches raising the popup, but since 2026-08-07 the popup opens ONLY on the server's say-so, so that risk is already handled a better way; checkWithinLotIdle also early-returns under threshold and idleConfirmRef stops overlapping server calls. Optional belt-and-braces: a ~60s interval while a lot is open calling the same check, for the case where they never touch that tab again at all.
⚠ Do NOT "fix" this by making the report subtract the lot's own duration. Save-to-save is the honest measure and the backstop - subtracting the lot time would make a wizard left open all afternoon invisible, which is exactly what this report exists to surface.`,
  },
  {
    filename: "manage_lots_bulk_undo.md",
    content: `---
name: Manage Lots — filters persist, bulk conditions/clear, Undo
purpose: The 2026-07-17 Auction Manager changes. Read before touching Manage Lots bulk actions or filters.
last_updated: 2026-07-17
---

# Auction Manager (Manage Lots) — 5 changes (2026-07-17) — NEEDS RUN MIGRATIONS

All in auction-tabs.tsx (ManageLotsTab) + lib/actions/catalogue.ts.

1. **Filters survive opening a lot.** Opening a lot pushes ?lot=, which swaps the tab for the editor and unmounts ManageLotsTab, losing all filter/sort state. Fixed with sessionStorage keyed catalogue_filters_<auctionId> (restore on mount, save on change). ⚠ Selection is deliberately NOT persisted — a stale tick could drive a bulk action at the wrong lots.

2. **Add Conditions respects selection.** bulkAddConditionsToDescriptions was auction-wide always (the bug); now scoped to selected lots if any ticked, else all (same as Remove/Clear).

3. **Remove Conditions** — strips EVERY "Condition appears …" sentence, any wording, with its joiner.

⚠⚠ 2026-08-20 — ADD REPLACES, REMOVE STRIPS ALL (Jordan: "we are now getting duplicate conditions and removing them only removes one"). The old Add de-duplicated with description.includes("Condition appears <CURRENT condition>.") and Remove stripped only that exact sentence — so a lot regraded AFTER its sentence went in (a box condition added, a Locking Check suggestion accepted) got a SECOND sentence, and Remove only took the current one. Now ONE shared helper set in lib/condition.ts — withConditionSentence (strip any existing, append the current one on its own line), stripConditionSentences, hasConditionSentence, conditionSentence (no doubled full stop when the condition already ends in one) — used by all three call sites: bulk Add, bulk Remove, and the per-lot "+ Add condition to description" button. A sentence runs from "Condition appears" to the END OF ITS LINE (a box condition has a full stop mid-sentence). Remove is no longer filtered to lots with a condition set — a lot whose grade was cleared still carries the sentence. Never reintroduce an exact-text includes() check.

⚠ 2026-08-19 — ADD CONDITIONS JOINS WITH A NEW LINE, NOT A SPACE (Jordan). The condition is its own statement, not the tail of the description's last sentence. Changed in THREE places that must stay in step: bulkAddConditionsToDescriptions (the ✚ Add Conditions bulk button), addConditionToDesc in auction-tabs.tsx (the per-lot "+ Add condition to description" button), and the remover. ⚠ bulkRemoveConditionsFromDescriptions now strips BOTH joins — newline first, then space, then bare — because every lot conditioned before this change still carries the space form; dropping the space branch would strand them. Nothing downstream needed changing: lib/condition.ts norm() collapses \s+ to a single space, so checkConditionInDescription, the Locking Check condDesc criterion and the Description Copier condition check all treat a newline exactly like a space.

4. **Clear Descriptions** — ALWAYS skips aiExcluded lots (hand-typed descriptions), regardless of selection. Clears description; title becomes "Untitled".

5. **Multi-step, conflict-safe Undo.** New CatalogueBulkUndo table (NEEDS Run Migrations). Every field-editing bulk action records a per-lot before/after snapshot; the amber "↶ Undo: <label>" button (top of toolbar) reverses the most recent, press again to step back. Conflict-safe: a lot changed since the action is skipped, never clobbered. Scoped to the actor (you undo only your own mass actions). Covers add/remove conditions, clear descriptions, bulk AI-exclude, bulk added-to-BC — NOT delete/transfer/photos.

⚠ Dedicated table, not the change log — the log stores display labels + best-effort rows, too lossy to reverse. Degrades gracefully pre-migration (undo just doesn't appear).

## 2026-07-22 — toolbar tidy + Status column removed
- Toolbar regrouped into one bordered bar with labelled groups: Undo (when present) · Tools (Pull Vendor/Receipt, Mass Add, Set Starting Bids, Unique ID Matcher) · Descriptions (Add/Remove Conditions, Clear Descriptions — group label shows "— N ticked" / "— all lots") · Export (BC Macro Tote/Receipt, Photos .zip, Excel, shortened labels). Status messages collect on one line under the bar. A separate teal SELECTION BAR appears when lots are ticked, led by an "N selected" chip: Mark added to BC, Exclude from AI, Generate Titles, Transfer, divider, then the destructive trio (Unlink photos / Delete photos from storage / Delete lots). All handlers and !bcLocked gating unchanged; shared styles TB_LABEL/TB_BTN/TB_NEUTRAL.
- Status column REMOVED from the table ("doesn't mean anything") — header, filter, pill, sort option, STATUS_STYLES gone; a saved sortCol "status" in sessionStorage is ignored on restore. Lot status data untouched, just not shown here. STATUSES constant kept (lot editor uses it).
- AI column filter is now ONE combined dropdown (fAi): All / 🚫 Excluded from AI / Not excluded / ✨ Upgraded / Not upgraded. The old fAiExcluded state filtered but had NO dropdown in the UI — this exposed it. sessionStorage restore maps old fAiUpgraded/fAiExcluded shapes into fAi.`,
  },
  {
    filename: "local_boot_safety.md",
    content: `---
name: Local boot safety — server.js only does its DB jobs in production
purpose: Why server.js gates migrations, the live-auction reset and the cron loops on !dev, and what running locally still touches. Read before changing server.js boot.
last_updated: 2026-07-17
---

# Local boot safety — server.js (guarded 2026-07-17, STAGING)

server.js used to do three things on **every** boot, local included. **.env on a dev machine points at the REAL shared Neon database** (and the real R2 bucket), not a local copy — so simply starting the app on a laptop fired all of it at live data, unattended, with nobody choosing it:

- **runMigrations()** — prisma migrate deploy against the shared DB, from a laptop, off a work-in-progress branch, completely outside the deliberate Run Migrations button flow.
- **resetStaleLiveAuctions()** — UPDATE "LiveAuction" SET status='PENDING' on every ACTIVE or PAUSED auction. **During a live sale this drops the live banner off the public site.** Correct on a real restart (in-memory state is lost); wrong from a laptop.
- **Four cron loops** — bc-warehouse sync, db-backup (dumps the shared DB to the real R2 bucket and eats one of the 30 retained backups), it-mailbox and condition-mailbox. The last two poll every 5 min (first run 90s/100s) and turn **real IT@vectis.co.uk / condition-report emails** into Job Board jobs and Condition Reports.

## The guard

All three are now gated on the module-level **dev** flag (NODE_ENV !== 'production') that server.js already computes: an if/else around runMigrations + resetStaleLiveAuctions in app.prepare().then(), and an early return before the cron block inside httpServer.listen() (the crons are last in the callback, so no re-indent was needed).

**Why dev is the safe signal:** it is the same flag passed to next({ dev }). If it were ever true on Railway, Next would be running in dev mode there — independently catastrophic and obvious. Railway is NODE_ENV=production (proved by app-page-turbo.runtime.prod.js, the prod runtime, in its stack traces). **The production code path was not edited at all** — only an untaken branch was added above it.

## Verified both directions (bogus DATABASE_URL, so the real DB was never at risk)

- NODE_ENV unset → "Dev mode — skipping migrations…" + "Dev mode — background cron loops not scheduled"; no migrate, no reset, no [cron/db-backup] line.
- NODE_ENV=production → migrate deploy attempted, reset attempted (both failed harmlessly on the bogus URL, caught by the existing try/catch), and "[cron/db-backup] next backup in 808 minutes" printed. **Railway behaviour identical.**

Reuse the bogus-DATABASE_URL trick to test anything on this boot path — it makes the test zero-risk even if the logic is inverted.

## ⚠ Still true — the guard is a seatbelt, not a cure

.env **still points at the shared Neon DB and real R2 bucket**. The guard only stops the **unattended** boot jobs. Anyone running locally and clicking around is still reading and writing **real production data**. CRON_SECRET is absent from local .env, which is a second accidental layer — do not rely on it (copying the Railway variables across to get local dev working is the obvious setup move, and would re-arm the mailbox polls). A real fix = a separate dev database; not worth it while nobody runs locally.

**npx next dev** skips server.js entirely and is the lightest way to run a page locally.`,
  },
  {
    filename: "deploy_skew.md",
    content: `---
name: Deploy skew — "Failed to find Server Action"
purpose: Why that Railway error appears and how the silent auto-reload fix works. Read before touching app/error.tsx, components/skew-reload.tsx or lib/skew-reload.ts.
last_updated: 2026-07-17
---

# Deploy skew — "Failed to find Server Action" (2026-07-17, STAGING)

**This Railway log line is NOT a code bug — do not chase it as one.** Next hashes server action IDs per build, and Railway serves exactly one build at a time. Any tab left open across a deploy (the shared cataloguing iPads, a login page someone left sitting there) calls IDs the new server has never heard of, so it answers 404 and the call rejects. A refresh fixes it — which is why it looks intermittent and why it shows up "when people try to access the site". The **login page is the most visible victim**.

⚠ The **[auth][error] CredentialsSignin** lines that appear alongside it are **unrelated** — that is NextAuth logging a wrong email/password. Normal noise.

## The fix — silent auto-reload

Next 16.2 exposes **unstable_isUnrecognizedActionError** from next/navigation for exactly this; it does NOT auto-recover for you. Three files:

- **lib/skew-reload.ts** — shared guard (isSkewError / willReloadForSkew / maybeReloadForSkew).
- **app/error.tsx** — the app's **first ever error boundary** (there were none before). Catches actions dispatched through a **transition** (useActionState — the login form).
- **components/skew-reload.tsx** — an unhandledrejection listener mounted in app/layout.tsx (renders null, follows the crt-mode.tsx pattern).

⚠ **BOTH are required — don't delete one as redundant.** The error boundary only sees transition-dispatched actions. **Most of the Hub awaits actions directly in a click handler** (await createLot / updateLot / saveLotDescription), where a rejection surfaces as an unhandled rejection the boundary never sees — the button would just silently do nothing. That is the cataloguers' Save path, i.e. the case that actually matters.

**Loop guard:** sessionStorage vectis_skew_reload_at, 10s window. A fresh build resolves the action on the next attempt, so a miss landing back within 10s means the reload didn't help — **fall through to the error card, never a blank screen**. (First cut returned null unconditionally for any skew error = white screen with no way out.)

**Known limit:** a call site that wraps the action in its own try/catch swallows the skew error, so no reload — the user sees that site's own error instead. Not globally fixable.

## Verified, not assumed

Tested by patching window.fetch to return the real post-deploy response (404 + x-nextjs-action-not-found: 1) on any POST carrying a next-action header, then clicking Sign in. Proof of reload = a marker set on window disappears. Console confirmed the UnrecognizedActionError "was handled by the <ErrorBoundaryHandler> error boundary". Reuse this trick — a two-build skew test is otherwise impractical.

## Running this project locally

Discovered during this work: server.js fired prisma migrate deploy, the live-auction reset and the cron loops at the **REAL** shared DB on any local boot. **Now guarded (2026-07-17)** — see the Local boot safety entry. **Use npx next dev** — it skips server.js entirely. ⚠ Don't commit a .claude/launch.json into the repo: .claude is **not** gitignored.

## TypeScript gotcha

unstable_isUnrecognizedActionError is a **type predicate**. Aliasing it (const isSkew = unstable_isUnrecognizedActionError(error)) narrows error to **never** after an early return, hiding error.digest. Annotate : boolean, or don't alias it.

## Considered and NOT adopted

next.config.ts **deploymentId** (from RAILWAY_GIT_COMMIT_SHA) would cache-bust assets and force a hard reload on mismatched *navigations*. Rejected for now: it does **not** fix the case that matters (a stale tab submitting without navigating first — the server doesn't reject on the x-deployment-id header, it just fails to find the action), and it must match at **build AND runtime** or every client mismatches forever, causing a reload loop. Revisit only if skew persists.`,
  },
  {
    filename: "jordan_secret_menu.md",
    content: `---
name: Secret /jordan menu + CRT mode
purpose: Jordan's personal easter-egg page and the app-wide CRT effect. Read before touching /jordan, components/crt-mode.tsx, or the crt-mode CSS in globals.css.
last_updated: 2026-07-02
---

# Secret /jordan menu + Retro CRT mode (2026-07-02)

A deliberate easter egg — do not "clean it up". The page at /jordan (app/(app)/jordan/) is gated server-side: the session user's User.username must equal "jordan.orange" (case-insensitive); everyone else — including other admins — gets a plain 404 via notFound(), as if the route doesn't exist. It is allowed to reach production on normal merges.

- Feature 01, Retro CRT mode: toggles the html.crt-mode class — scanlines, green phosphor tint, vignette and a subtle flicker across the whole Hub. CSS lives at the bottom of app/globals.css and uses FIXED OVERLAY PSEUDO-ELEMENTS ONLY — never apply a filter to html/body, because a root filter creates a containing block and breaks every position:fixed element in the app (sync bars, modals, floating buttons).
- Persistence: localStorage key jordan_crt_mode ("1" = on), per browser. components/crt-mode.tsx (mounted in the (app) layout, renders null) re-applies the class on load so the mode survives navigation and reloads. The flag can only be set from /jordan.
- If /jordan 404s for Jordan himself: his Hub user needs username = Jordan.Orange (Admin -> Users).

## Slots 02 + 03 (added same day): Ask AI + Cooking
- The gate is shared via lib/jordan-auth.ts isJordan() — pages call notFound(), the API routes return 404 JSON, so none of it exists for anyone else.
- 02 ASK AI (/jordan/chat): casual day-to-day AI chat. 03 COOKING (/jordan/cooking): two tabs — Air Fryer Converter (photo upload -> POST /api/jordan/airfryer, Gemini vision returning strict JSON {food, state, mode, tempC, time, preheat, shake, safety, notes, confident} rendered as a settings card with an amber not-confident warning) and Ask the Chef (cooking-expert chat, UK measures).
- "My air fryer" profile: a collapsible panel on the converter lets Jordan enter his machine's model/notes and its exact cooking modes (chips). Saved per browser in localStorage jordan_airfryer_profile {notes, modes}, sent as applianceNotes + applianceModes; buildPrompt tailors temp/time to the appliance and, when modes are given, makes the AI recommend EXACTLY one of them (shown as a big MODE card). A "Scan my air fryer" button (POST /api/jordan/airfryer-scan, vision) reads the mode names + model off a photo of the appliance and merges them into the profile.
- Web search: both chats have a "WEB SEARCH [ON/OFF]" toggle in the footer. When on, /api/jordan/chat enables Gemini Google Search grounding (tools:[{googleSearch:{}}], same pattern as auction-ai chat-grounded) and returns the search queries, shown above the reply. A model without grounding support returns a clear 400 telling Jordan to turn it off or switch model.

## MCOC is ONE menu section (Counters + Roster tabs) — NEEDS RUN MIGRATIONS
- The secret menu has a single "MCOC" entry -> /jordan/mcoc, a tabbed hub (mcoc-hub.tsx): Counters + My Roster. Both tabs stay mounted (hidden when inactive) so switching keeps state. The page loads the roster server-side and passes it to the hub; ?tab=roster opens the roster tab, and /jordan/roster now just redirects to /jordan/mcoc?tab=roster.
- The roster tab stores Jordan's Marvel Contest of Champions roster in a new McocChampion table {ownerId, name, class, stars (6/7), rank (1-5), bgsDeck} unique on (ownerId,name,stars). Added to schema.prisma AND the run-migrations MIGRATIONS array — click Admin -> Run Migrations after deploy or the roster page 500s.
- Add champions by photo: POST /api/jordan/mcoc/scan-roster (Gemini vision) reads champion names + class (from portrait border colours) off a roster screenshot; a confirm step lets Jordan untick misreads, then addChampions upserts them at the chosen stars/rank with an optional "add to BGS deck" flag. Manual add too.
- Server actions in lib/actions/mcoc.ts (all jordan-gated): addChampions, updateChampion, deleteChampion, setBgsDeck, setBgsDeckByNames. Shared constants in lib/mcoc.ts (MCOC_CLASSES, classColour, normaliseClass). Client groups by rank, per-champ star toggles BGS membership, click name to edit class/stars/rank.
- Portraits + update + deck-fix (2026-07-02) — NEEDS RUN MIGRATIONS again (McocChampion.imageKey column). The scan-roster route now reads each champ's name/class/RANK plus a portrait bounding box, crops the portrait with sharp and stores it in R2 (mcoc/{userId}/...); the mcoc page signs imageKey into imageUrl. Portraits show in roster chips, scan-confirm lists and owned counter cards (fallback = class-coloured square).
- Roster scan is now add AND update: BOTH the "These are 7*/6*" and the Rank selector are authoritative for the whole batch (a roster screenshot is one rank tier). The AI reads a per-champ rank but MISREADS the small badges (it put rank-5-selected champs in as rank 2/1), so the client ignores the AI rank and defaults every champ to the SELECTED rank; the per-champ dropdown in the confirm list is only for exceptions. addChampions upserts by (owner,name,stars) updating rank+class+portrait, so uploading each rank tier updates ranks. This is the "update roster by photo" feature.
- BGS deck matching root cause + real fix: it kept being wrong (while roster-scan worked) because a roster grid prints champ NAMES under each portrait (easy to read) but a Battlegrounds deck screen is mostly portraits with little/no text, so reading names blind misfired and could return champs Jordan doesn't own. Fix: a dedicated POST /api/jordan/mcoc/scan-bgs takes the deck image + the roster champ names and asks the AI which of THOSE owned champions appear (recognition against a known list, server-filtered to real roster names). The client sends the roster names, maps matches to ids, shows a confirm/untick review, and applies via applyBgsDeck(ids, replace). The star toggle on each roster chip is the manual 100%-accurate alternative.
- Counters tab now receives the roster and flags each suggested counter as OWNED (with stars/rank + portrait) or not-in-roster, matched by normChampName.

## MCOC Champion DB (Phase 2a) — NEEDS RUN MIGRATIONS
- Data foundation for the (not-yet-built) instant counter engine. There is no reliable public MCOC data source (Fandom blocks scraping; GitHub datasets are stale 2017/2019; the good live tools have no API), so the app builds its own with grounded AI and caches it.
- New global McocChampionProfile table (id, name, nameNorm unique, class, immunities[], tags[], summary, profileAt) — needs Run Migrations. Fixed MCOC_IMMUNITIES + MCOC_TAGS vocab in lib/mcoc.ts; lib/mcoc-ai.ts has groundedJson + parseLooseJson (grounding can't use JSON response-mime so parse loosely; ungrounded fallback).
- Routes: POST /api/jordan/mcoc/catalog {class} grounded-lists all champs of a class and upserts names (client loops the 6 classes); POST .../profiles/build {limit, staleBefore?} profiles a batch (grounded, tags/immunities filtered to the vocab) — staleBefore null = build unbuilt only, set = refresh all older than it; both terminate as done champs' profileAt->now drop out. GET .../profiles/status and .../profiles/list.
- UI: a "Champion DB" tab in the MCOC hub (mounts on demand): status + progress, (1) Build champion list, (2) Build profiles (client loops until done, stops after 3 zero-progress rounds = rate limits), Update meta (refresh), and browse/search by name/tag/immunity. The build is long (~250 champs, one grounded call each) but resumable.
- Phase 2b BUILT — the big MCOC expansion (2026-07-02). The MCOC hub now has FIVE tabs: Counters, Roster, Deck Builder, War, Champion DB. NEEDS Run Migrations (McocChampionProfile gains abilities JSONB, counters TEXT[], defenderNotes TEXT) and then an "Update meta" re-scan so existing profiles gain the new fields.
- Profile v2: the build prompt also returns abilities [{name, details[]}] (spotlight-style kit breakdown like mcoc.gg), counters (best attackers into this champ as a defender) and defenderNotes. profiles/list is slim by default; ?full=1 adds abilities (Champion DB browse uses it). groundedJson accepts a parts array for image+text grounded calls.
- INSTANT counters mode (default in the Counters tab — the "no AI wait in BGS" ask): loads the slim profile list once, pick a defender by autocomplete, and it instantly renders class + class-advantage chip, immunities, defender notes and the stored counters matched to the roster (in-deck first, then owned, then unowned; "BGS deck only" filter). The grounded AI lookup remains as the second mode.
- Champion DB rows now expand to a full detail view: abilities sections, best-counters chips (owned flagged with portraits), defender notes; prompts to run Update meta when a profile predates the new fields.
- DECK BUILDER tab: photograph the BGS season's nodes/meta (or describe it) + your roster -> a full N-champ deck (roles Attacker/Defender/Flex with reasons, strategy, watchouts) via POST /api/jordan/mcoc/deck-builder; "Set as my BGS deck" applies the matched champs.
- WAR tab: Attack Path planner (enter the path's defenders + optional node notes -> best 3-champ team with per-fight assignments, risks, alternates via /api/jordan/mcoc/aw-path) and Defence Placer (optional map photo + notes + count -> node-by-node placements via /api/jordan/mcoc/aw-defence).
- Manual BGS deck add: the deck panel has a type-ahead "add by name" box and a current-deck chip row (tap x to remove), alongside the star toggle on each roster chip.
- Personal counters: McocChampionProfile.myCounters (NEEDS Run Migrations) — Jordan's own counter picks per defender, kept separate from the AI counters so Update-meta rebuilds never touch them (the build route only writes counters). addMyCounter/removeMyCounter actions (matched by nameNorm, deduped, capped 12). The instant Counters view shows them as a gold "My counters" section pinned above the AI list (which hides duplicates), with an add box (roster autocomplete) and per-chip remove; the Champion DB detail shows them as read-only gold chips.
- (Earlier bug, already fixed: the scan buttons did nothing until the hidden file inputs were rendered.)
- Phase 2 (planned, not built): an instant local counter engine caching per-champ capability tags + per-defender requirement tags in the DB, matched at BGS draft time against the roster/deck (surfaces owned counters no guide lists), with an "Update meta" refresh button. Until then /jordan/mcoc stays an AI call per query.

## Slot 04 (added same day): MCOC Counters
- /jordan/mcoc — "who should I use against this defender?" for Marvel Contest of Champions. Type the defender + node/buffs and/or upload a screenshot -> POST /api/jordan/mcoc returns strict JSON {defender, counters:[{champion,class,why,how}], strategy, warnings, confident} rendered as class-coloured counter cards.
- Live META (Google Search grounding) is ON by default because the MCOC meta changes monthly and model knowledge goes stale. Grounding can't be combined with JSON responseMime on Gemini, so the prompt asks for JSON and the route parses it loosely (parseLooseJson); if the chosen model can't ground, the route retries ungrounded and flags groundedFallback. CTRL/Cmd+Enter submits.
- Both chats share app/(app)/jordan/chat-panel.tsx (retro terminal, history persisted per browser in localStorage jordan_chat_history / jordan_cooking_history capped at 60 messages) -> POST /api/jordan/chat with {message, history:[{role,text}], mode} — the mode picks the system prompt; history is converted server-side to Gemini's shape, capped at 30 turns.
- Model resolved via getToolModel("jordan_fun", clientModel) — slot registered in AI_TOOLS (group Other) per the central AI-model-config rule. Standard Gemini block handling (422 on blocks). A MODEL selector (model-picker.tsx; localStorage jordan_ai_model, blank = AUTO/default; options from /api/auction-ai/models) sits in the chat footer and the airfryer tab, and both requests send the choice.
- 503/overloaded handling: lib/gemini-retry.ts (withGeminiRetry — 3 attempts with short backoff; isTransientGeminiError) wraps both routes, and after exhausted retries a friendly 503 message suggests switching model. The helper is reusable for other one-shot Gemini routes.
- Lint gotcha (hit twice here): the eslint react-compiler rule bans synchronous setState inside effects — localStorage restores are wrapped in queueMicrotask (chat-panel.tsx and jordan-menu.tsx).`,
  },
  {
    filename: "photo_ai_edit.md",
    content: `---
name: Photo Prep — AI edit (nano banana)
purpose: The Gemini image-editing tab in Photo Prep, its presets, the condition-integrity rule governing all of them, and why extend outpaints server-side and pastes the original back. Read before touching photo editing.
last_updated: 2026-08-04
---

# Photo Prep → 🎨 AI edit (built 2026-08-04)

Photo Prep is now **tabbed**: **🪄 Prepare photos** (the original local crop/brighten run) and **🎨 AI edit** (Gemini's image model, "nano banana"). A separate tab was chosen over folding it into the batch, so each tab's privacy promise stays unambiguous.

## ⚠⚠ CONDITION INTEGRITY — the rule the whole feature hangs on

These photographs are what bidders bid on. An edit that removes a scratch, chip, crack, fading, wear or a missing part **misrepresents the lot**. So every preset fixes the **PHOTOGRAPH** (framing, backdrop, lighting, glare, clutter around the item) and never the **ITEM**, and \`CONDITION_RULE\` in **lib/photo-edit-presets.ts** is appended to *every* prompt — telling the model in absolute terms not to clean, repair, restore or improve the object, and to return the image unchanged if it can't comply. **Test for any new preset: would a bidder feel misled seeing the original next to yours? If yes, don't add it.**

## The pieces

- **lib/photo-edit-presets.ts** — 13 presets in 4 groups, shared by route and UI so buttons and prompts can't drift. Framing (extend / straighten / centre), Background (clean sweep / cut out to white / remove clutter / remove label), Light (even lighting / kill glare / fix colour cast), Quality (sharpen / reduce grain / upscale / remove dust specks). \`buildEditPrompt(key, {extra})\` assembles preset + free text + CONDITION_RULE. Only \`extend\` offers the shape/direction/amount controls — see the outpainting note below.
- **app/api/photo-prep/edit/route.ts** — one photo per call; sharp applies EXIF rotation and caps the long edge at 2048px first. PHOTO_PREP app access required.
- **app/(app)/tools/photo-prep/ai-edit-tab.tsx** — choose photos → filmstrip → preset grid → Edit → before/after side by side → Download (keeps the original name + "-edited") or Discard.

## ⚠ Image editing is NOT the shape the other AI routes use

It is \`POST https://generativelanguage.googleapis.com/v1beta/interactions\` with header \`x-goog-api-key\`, body \`{model, input: [{type:"text",text},{type:"image",mime_type,data}]}\`, and the result arrives at **output_image.data** (base64) — *not* content parts. The installed @google/generative-ai (0.24.x) is the legacy SDK with **no image-output support**, which is why this route uses a direct fetch rather than the SDK or lib/ai-provider (text-out only). Verified against Google's docs. Multi-turn edits are possible via previous_interaction_id (not used yet).

✅ **Verified working end-to-end on staging (2026-08-04)** — "Extend the shot → Square" returned a real edited image and rendered before/after. ⚠ **The first attempt failed with "the model didn't return an image"** — that was our own fallback, because the doc's \`output_image.data\` path was hard-coded. **Don't hard-code one path**: \`extractImage()\` now walks the response for the first plausible base64 image (handles data / bytesBase64Encoded / imageBytes / b64_json and mime_type / mimeType, requiring >512 chars so an id isn't mistaken for an image), and \`extractText()\` surfaces the model's own words when it replies with a refusal. When there is genuinely no image the error names the response's top-level keys — otherwise it's undebuggable from outside. Google embeds **C2PA provenance metadata** in the result (a JUMBF block signed by Google C2PA Media Services) on top of the invisible SynthID watermark.

Model slot **photo_prep_edit** (Admin → AI Models, group Other), default \`gemini-3.1-flash-image\`; gemini-3-pro-image, gemini-3.1-flash-lite-image and nano-banana-pro-preview are also available. **Not claudeOk** — Claude writes text, not pictures.

## ⚠ “Extend the shot” is OUTPAINTING — asking alone did nothing (2026-08-04)

v1 just told the model to “extend this photograph outwards” and **the result came back unchanged** — same framing, same shape. A model handed a 16:9 photo has no reason to return anything but a 16:9 photo, so “extend it much higher” had nowhere to go.

**The fix: pad the real canvas BEFORE sending.** \`planPadding()\` in the route works out the new edges and \`sharp.extend()\` fills them with flat mid-grey (#808080, named in the prompt so the model can tell blank canvas from a genuinely grey backdrop); the prompt then says “paint into the grey only, leave every non-grey pixel exactly as it is”. That turns the job into *fill this gap* instead of *imagine a wider picture*, and it guarantees the original pixels survive — which asking never did. Padding happens **only** for \`extend\`; every other preset gets the photo as-is. The canvas is re-capped to 2048px after padding.

Three controls, all shared from lib/photo-edit-presets.ts: **Direction** (all round / ↕ taller / ↔ wider / ↑ above only / ↓ below only — Jordan asked for vertical-vs-horizontal specifically), **How much** (a little / some / a lot = 0.25 / 0.5 / 1.0 × the long edge) and **Shape**. ⚠ A chosen shape now only ever **ADDS** space — it never crops the photo to hit a ratio — and “above only”/“below only” keep the whole of a shape's extra height on that side. \`buildEditPrompt\` no longer takes \`aspect\`: the canvas expresses it, not the wording.


## ⚠ Quality — and why the original is composited back (2026-08-04)

Jordan: *“the quality coming back is a bit bad”.* Two causes, one of them serious.

1. **A double squeeze.** The photo was resized to 2048, padded, then resized to 2048 **again** — so the picture itself reached the model at a fraction of its size (with “a lot”, about a third). It now scales **once**, with the *padded canvas* as the 2048 target.
2. **⚠⚠ The model REDRAWS the whole picture.** It cannot “leave the original pixels alone” however firmly the prompt asks — nano-banana-class models re-render the entire frame. That is a quality loss *and* a **condition-integrity** failure: a redrawn item is no longer evidence of the item's condition, which is the one thing this feature may never touch. So \`extend\` now **composites the ORIGINAL back over the generated canvas at full resolution** (\`featherEdges()\` fades ~20px at any edge that gained canvas, so the joint doesn't show; an edge with no padding stays hard). Only the new border is AI-generated, and the item is **guaranteed** untouched rather than merely asked to be. Output is capped at FINAL_MAX 3000px. ⚠ Compositing applies to **\`extend\` only** — every other preset is *meant* to change the picture, so the model's output is returned as-is.

Padding is also now measured against the **axis being extended** (taller → height, wider → width), not always the long edge — “40% taller” on a wide photo used to be enormous.

If the generated border still isn't good enough, the model slot is the knob: **Admin → AI Models → Photo Prep AI edit** → \`gemini-3-pro-image\` instead of the \`gemini-3.1-flash-image\` default. No code change.

## ⚠ Mobile — the Download button did nothing (2026-08-04)

It set an anchor's \`href\` to the **data: URL** and clicked it while **detached from the DOM**. iOS Safari ignores \`download\` on a \`data:\` URL, and some browsers won't act on an anchor that isn't in the document — so on a phone the button was dead. Now: convert to a **Blob**, offer the **share sheet** first (\`navigator.canShare({files})\` — that's how you get “Save Image” into Photos on iOS; an AbortError means they cancelled, so do *not* then fire a download), and fall back to an object-URL anchor that **is** appended to \`document.body\`. “Download all” deliberately skips the share sheet (one sheet per photo is unusable). The tab also stacks on a phone: filmstrip becomes a horizontal scroller, before/after goes single-column.


## Privacy — the wording had to change

The Prepare tab said "photos are processed on this computer and never uploaded", which was **already not quite true** (the optional "fix with AI" step sends those few photos to Google for a crop box). The header is now per-tab: Prepare says cropping/brightening are local *and* names the AI-crop exception; AI edit says plainly that its photos **are** uploaded, that results carry an invisible SynthID watermark, and that the item is never altered. Gemini's entry on the Data & Compliance and DPIA pages now includes photo editing — keep both in sync.`,
  },
  {
    filename: "ai_providers.md",
    content: `---
name: Two AI providers — Gemini + Claude
purpose: The Hub can run an AI tool on Gemini OR Anthropic Claude, chosen per tool. Read before touching any AI route or the model registry.
last_updated: 2026-08-04
---

# Gemini + Claude, selectable per tool (built 2026-08-04)

Claude was added because it reasons about code better than Gemini (the BC Source tools were the trigger). Jordan chose the full version: **any capable tool** can be switched between providers from **Admin → AI Models**, with no code change.

**The model id decides the provider.** Anything starting with \`claude-\` goes to Anthropic; everything else to Gemini. That single rule lives in \`providerOf()\` in **lib/ai-provider.ts**, which also exports the one function routes call:

\`generateAiText({ model, prompt, system?, images?, history?, maxOutputTokens?, json? })\`

It hides both providers' quirks so ~30 call sites don't re-implement them: Gemini's promptFeedback.blockReason + finishReason checks (RULES: never call .text() first) and Claude's stop_reason "refusal" plus a **never-return-empty** guard (the empty-reply bug that poisoned BC Source chat histories is now impossible by construction). It throws \`AiBlockedError\` (surface it, don't retry) or \`AiNotConfiguredError\`.

⚠ **History handling is shared** — blank turns dropped, a leading assistant turn trimmed. BOTH providers reject those (Gemini: "parts[0].data: required oneof field 'data'"; Anthropic: "First content should be with role 'user'"). Don't re-add per-route history cleaning.

## ⚠ Only \`claudeOk\` slots may use Claude

\`AI_TOOLS\` in **lib/ai-models.ts** carries \`claudeOk?: boolean\`. **Only set it once that route actually calls generateAiText.** Converted so far (6): bc_source_guide, bc_source_chat, it_help, it_draft_reply, patch_notes_draft, catalogue_lot_history. Everything else still calls the Gemini SDK directly — images (batch, lens, accounts, smart scan, photo prep), chat history, or Google Search grounding (catalogue_chat_grounded is Gemini-only by nature).

Two guards keep the dropdown honest: the **admin page** only lists Claude ids for claudeOk slots (and "Set every tool to" never offers Claude), and **\`usable()\` inside getToolModel** falls back to the slot default when a Claude model is set on a non-claudeOk slot **or ANTHROPIC_API_KEY is missing**. Same spirit as RETIRED_MODELS: a bad config must never take a tool down, and environments can have different keys.

⚠ **TWO routes list models, and BOTH need Claude appending.** \`/api/auction-ai/models\` feeds the in-app pickers; **\`/api/auction-ai/model-config\` is what Admin → AI Models actually reads**. Patching only the first left every admin dropdown Gemini-only while everything else was correctly wired — found only by clicking the page (2026-08-04).

✅ **Verified live on staging**: all 3 Claude ids offered, the 6 claudeOk slots switchable, BC Source set to claude-opus-5 and answering from the real AL source. Claude is slower (~25-30s vs Gemini's 11-20s) and markedly more precise — on the lotting-order question Gemini said "the source doesn't contain this" while Claude walked through the per-category lines, the report's follow-up passes with their exact prompts, EVA_FindLastCatLotNo, the other filters, and the Sort Lots / Missing Lots tidy-up.

## Facts checked against the current API, not remembered

- Model ids are exact with **NO date suffix**: claude-opus-5, claude-sonnet-5, claude-haiku-4-5. Appending a date 404s.
- Opus 5: 1M context, $5/$25 per M tokens in/out.
- **No temperature / top_p / top_k** on Opus 5 — sending any is a **400**. Don't port Gemini sampling settings over.
- **Thinking is ON by default**, and max_tokens caps thinking + answer together — hence roomy maxOutputTokens.
- **Stream anything big** (\`messages.stream()\` + \`.finalMessage()\`); a non-streaming call with high max_tokens hits the SDK HTTP timeout. The provider layer always streams.
- Claude has no responseMimeType — JSON mode is a prompt instruction plus a fence strip.
- SDK \`@anthropic-ai/sdk\`; key **ANTHROPIC_API_KEY** in Railway (separate account and billing from Google).
- Rough cost at Opus 5: a BC Source question ~30p, a small guide ~15p, a guide for Evo-auction - Base ~£1.20. Gemini Flash is pennies.

Anthropic was added to the **Data & Compliance** and **DPIA** processor lists. **To make another tool switchable:** convert its route to generateAiText FIRST, then set claudeOk: true.`,
  },
  {
    filename: "bc_source_browser.md",
    content: `---
name: BC Source browser (IT Tools)
purpose: The in-app copy of the Evo-soft Business Central source with AI guides + chat. Read before touching it.
last_updated: 2026-08-03
---

# IT Tools → BC Source (built 2026-08-03)

Third tab on /tools/it-tools (\`bc-source-tab.tsx\`): the complete Evo-soft AL source for our Business Central, uploaded into the app so staff can browse it, search it, and have it explained.

**How the source gets in:** an **admin-only** zip upload — the server unzips with jszip and stores text files in \`BcSourceFile\`, replace-all in one transaction. ⚠ **The source lives in the DB, deliberately NOT in the git repo** — it is Evo-soft's proprietary code and must stay out of GitHub. Viewing needs only the IT Tools app permission; replacing the source needs ADMIN.

⚠ **An extension = a folder that directly contains \`app.json\`.** Do NOT go back to "strip one shared wrapper folder" — that was v1 and it broke on the real archive (2026-08-04): the zipped folder (BCN Vectis Source Code) has **TWO** roots, \`Source/\` plus a sibling \`Webservices - PTE\`, so the single-root rule never fired and all 62 extensions were filed under one fake extension called "Source". Keying on app.json makes any zip shape work. Verified against the real tree: **63 extensions, 2,989 files**. Duplicate display names fall back to the full folder path, because \`path\` is @unique and a collision would fail the whole upload. \`Webservices - PTE\` is a genuine extension and an important one — it holds APIReceiptTotes / APIShipmentRequest, the OData pages the Hub reads.

⚠ **The stored source is ~23 MB** (a \`du\` on the OneDrive folder reports ~2.7 MB because the files are cloud-only placeholders until read — that figure lies). Size any budget off 23 MB.

**Routes** (all under \`app/api/it-tools/bc-source/\`):
- **files** — extension list → per-extension files (grouped by AL object kind: Table/Page/Codeunit/…) → file content. A missing table (pre-Run-Migrations) presents as "nothing uploaded yet", never a 500.
- **search** — case-insensitive search across every file (path + content), matching lines with line numbers, click-through to the viewer.
- **guide** — one plain-English guide per extension, generated by Gemini from the actual source (slot \`bc_source_guide\`), stored in \`BcSourceGuide\`, with ✨ Regenerate (confirm warns if the guide was hand-edited) and ✎ Edit. The prompt demands **plain text, NO markdown** (nothing in the app renders \`**\`), CAPITAL headings, and six fixed sections: what it is / the screens / the data / how it works / how it connects / jargon.

  ⚠ **Two-tier packing, because the big extensions are genuinely big** — Evo-auction - Base alone is **7.5 MB / 1,113 files**, so the original flat "include files until the budget runs out" wrote the most important guide from about 5% of it. Now: verbatim source to FULL_BUDGET (700k chars), then the remaining code files go in **condensed** form (object declaration + procedure/trigger names, Caption/ToolTip/field/action lines) to CONDENSED_BUDGET (250k), and only then are files dropped. The prompt labels those OUTLINE ONLY and tells the model to name what exists without inventing how it works. Measured on a 13-file extension: 13 s, ~4.8k chars, no markdown leakage, content accurate.
- ⚠ **Both AI routes now go through \`generateAiText\` (lib/ai-provider.ts) and can run on Gemini OR Claude** — set per tool in Admin → AI Models; Claude Opus 5's 1M window swallows even Evo-auction - Base. See the "Two AI providers" entry. The empty-answer guard below now lives in the provider layer.
- **chat** — ⚠ **GEMINI HISTORY RULES — one blank reply used to break a conversation permanently** (found 2026-08-04, "it keeps getting stuck"). Two chained bugs: a reply came back with **no text** (a thinking-capable model can spend its whole output budget reasoning), rendering as a blank bubble that looks like a hang; that empty message then went back up as history, and **Gemini 400s the entire request if any history part is empty** — contents[N].parts[0].data: required oneof field 'data' must have one initialized field — so every later question in that thread failed. Guards now exist in BOTH halves, keep them: the server strips blank turns, **trims the history to start on a user turn** (the slice(-8) could begin on a model reply, which Gemini also rejects: "First content should be with role 'user'"), returns a clear error instead of an empty answer, and uses a roomier maxOutputTokens (16384); the client marks a failed turn and **excludes it from the history it sends**, showing an error notice rather than an empty bubble. Verified against the exact poisoned shape.
- **chat** — "Ask the code": keyword scoring (same retrieval pattern as IT Help's ask route; path matches weighted ×4), top ~25 files (≤300k chars) to Gemini (slot \`bc_source_chat\`), answering **citing file paths**; cited files are clickable chips that open in the browser. ⚠ It **shortlists in SQL, RANKED** — v1 loaded every file to score in JS (23 MB per question, a container spike); v2 fixed that with a plain OR-contains + take 400, which returned an **arbitrary** 400 rows and broke relevance: asking "filter and group the lots by category and start at lot 600" answered "the source doesn't contain this" while **naming the very files it needed**. The score is now computed in Postgres (a **path** match worth 5x a body hit), ordered, top 60 — don't revert to an unordered take. ⚠ **Follow-ups also need the previous answer's files carried forward**: the client sends \`pinnedIds\` (the ids the last answer cited) and the route always includes them with a large score bonus, so the \`score > 0\` filter can't drop them — that filter would otherwise discard the pinned files, which is the whole point of pinning.

📎 **Screenshots in "Ask the code" (2026-08-04).** Paste (Ctrl+V) or 📎-attach up to **4** screenshots of the BC screen alongside the question. Downscaled client-side to 1800px / JPEG 0.9 (\`processImage\`, mirrors jordan/chat-panel) — readable for BC's small on-screen text without a huge base64 payload. Sent as \`images: [{mimeType, data}]\` and passed straight to \`generateAiText\`, so BOTH providers handle them. When pictures are attached the prompt gains a block telling the model to read what's filled in, compare it against the code, and **say which it is** — wrong values (with exactly what to change) or a genuine code limitation (which object and why) — plus locate where any visible error text is raised. ⚠ **A screenshot alone can't retrieve anything** (retrieval is keyword-based on the question text), so a picture with no words returns "add a few words — name the screen, field or error" rather than answering from nothing.

Tables \`BcSourceFile\` + \`BcSourceGuide\` — **NEEDS Run Migrations**. Both AI slots are in \`AI_TOOLS\` (group IT) per the central model-config rule. The compliance + DPIA inventories were updated (BC source stored in Neon; vendor source code sent to Gemini — no personal data either way).

⚠ **Re-uploading the source does NOT touch stored guides** — after a BC update, stale guides need regenerating by hand (the generatedAt date on each guide is the tell).`,
  },
  {
    filename: "tote_check.md",
    content: `---
name: Vendor / Tote Check tab
purpose: The per-auction tab that checks lots against the BC tote data. Read before touching it or changing where tote data comes from.
last_updated: 2026-07-31
---

# Vendor / Tote Check (built 2026-07-31)

A per-auction tab (**🧾 Tote Check**, sitting between Locking Check and BC Check) answering *"does this lot still agree with the tote it was catalogued from?"*.

**Source of truth = \`WarehouseTote\`** (BC-synced: \`toteNo → receiptNo → vendorNo/vendorName\`) — deliberately the SAME table the lot wizard's tote box reads through \`/api/warehouse/tote-search\`, so the check measures each lot against what the cataloguer was actually shown. ⚠ Do **not** switch it to \`WarehouseContainer\`/\`WarehouseReceipt\` — those belong to the separate internal warehouse tool (that lineage is what \`fillLotsFromTotes\` uses).

- **Route:** \`app/api/catalogue/tote-check/route.ts\` (GET \`?auctionId=\`) → \`{checked, clean, rows, lastSync}\`; exports the \`ToteCheckRow\` / \`ToteCheckIssue\` types the tab imports.
- **Tab:** \`app/(app)/tools/cataloguing/auctions/[id]/tote-check-tab.tsx\` — summary line, clickable issue chips that filter the table, full-width table (Barcode · Unique ID · Tote · What's wrong · BC says · On the lot · Added by), row click opens the lot in Manage Lots.
- **Issues:** receipt_mismatch, vendor_mismatch, unique_id_mismatch (red — the unique ID's R008729 prefix disagrees with the lot's receipt field), receipt_missing, vendor_missing, tote_unknown (amber), no_tote (grey).

⚠⚠ 2026-08-20 — "BC SAYS" DID NOT MEAN BC, AND MATCH BC WOULD HAVE CORRUPTED 4 CORRECT LOTS. F109 reported 4 lots as "BC says R006447 / on the lot R006956". BC's own Receipt Lines had them on R006956-77..80 (barcodes F109403-F109406), with Article Tote No. BLANK - the Hub was right, BC was right, they agreed, all 4 were false positives. CAUSE: checkLot compares lot.receipt against tote.receiptNo, which is BC's view of the TOTE, not of the LOT; the file's premise assumed those were the same thing. ⚠ THE DANGER: receipt_mismatch is what Match BC acts on and it WRITES the tote's receipt onto the lot, so the "Match BC (4)" button would have rewritten four correct lots to R006447, out of step with BC and with their own BC-issued unique IDs - and the same flag is what puts a lot on BC Corrections. FIX: the unique ID arbitrates. BC issues it and it carries the receipt as a prefix, so when the receipt disagrees with the tote BUT the uid prefix matches the lot's receipt, checkLot now raises the new tote_receipt_mismatch (amber) instead. Nothing acts on the new key, so Match BC skips it, BC Corrections excludes it, and it stays visible everywhere worded as a TOTE problem. ⚠ Accepted trade: a legacy Hub-minted uid was derived from lot.receipt so its prefix always matches and corroborates nothing - those lots stop being auto-corrected, chosen deliberately because not auto-writing is the safe side. The Tote Check column "BC says" now reads "The tote is on". ⚠⚠ METHOD: a "BC says" column is only as true as the TABLE it came from - WarehouseTote describes totes, not lots. Check which BC table any Hub-vs-BC comparison actually read.

⚠⚠ 2026-08-20, THE ROOT CAUSE - A TOTE NUMBER IS NOT UNIQUE. Jordan, after opening BC: "the customer has duplicated receipts with the same tote number on both so there may be different receipt numbers even though its the same customer". C L Parsons had tote P005022 on BOTH R006447 and R006956. buildToteMap was new Map(totes.map(t => [norm(t.toteNo), t])) - a duplicate key SILENTLY OVERWRITES, so one receipt vanished and every lot on the losing one was reported mismatched, with the winner depending on ROW ORDER (the same data could read differently between syncs). That is the true cause of F109's four false positives; the unique-ID arbitration added earlier that day was treating the symptom. FIXED: the map keeps EVERY copy (Map<string, BcTote[]>) and a lot is fine if its receipt or vendor matches ANY of them; only checkLot consumed the map so the change was contained, and checkLot prefers the copy whose receipt the lot is actually on. ⚠⚠ THE WRITE PATH IS GUARDED: LotToteVerdict gained copies: BcTote[], and Match BC REFUSES to write receipt or vendor when copies.length > 1 - with two receipts on one tote there is no single right answer and picking one is a coin flip. ⚠ GENERAL LESSON: new Map(array.map(...)) is silent data loss whenever the key is not genuinely unique. Tote numbers, receipt numbers and barcodes have ALL turned out to be non-unique here at some point.

⚠⚠ SAME DAY, REVERTED AT JORDAN'S REQUEST: "The flagging itself how it was before was fine as I found the issue from investigating myself so as long as the BC corrections tab is fixed we are okay." checkLot and buildToteMap are EXACTLY as they were - the tote_receipt_mismatch arbitration, the multi-receipt tote map, the tote_duplicate_receipts issue, the consumer labels and the "BC says" rename were all reverted. DO NOT RE-APPLY. The flagging being noisy is what led him to open BC and find the duplicated receipts; a cleverer check would have hidden the real fault. TWO THINGS KEPT: (1) BC Corrections is live-only, which is what he actually asked for; (2) duplicateToteNumbers() plus a Match BC write guard - a new export used ONLY by the write path, so nothing reported changes, which skips any lot whose tote is booked onto two receipts because the map's winner is decided by row order and that button would have rewritten four CORRECT lots. ⚠ THE DISTINCTION TO PRESERVE: reporting a doubt is useful, silently writing a guess is not. Keep the checks noisy and the writes cautious.
- The comparison itself lives in **\`lib/tote-check.ts\`** (\`checkLot\`, \`toteLookupVariants\`, \`buildToteMap\`, \`norm\`) — shared by the route AND the Match BC button, so the button can never fix something different from what the report shows.

## "✓ Match BC" + the BC Corrections tab (2026-08-03)

Jordan's rule: **BC is correct; our system was wrong; and because our system was wrong we have most likely pushed the wrong values INTO BC.** Two halves:

1. **✓ Match BC** — button on Tote Check behind a confirm that lists exactly what will happen → \`autocorrectLotsFromTotes(auctionId)\` in lib/actions/catalogue.ts. Rewrites each lot's vendor/receipt to the tote's BC values, through \`updateLotLogged\` with \`source: "tote_autocorrect"\` and one shared batchId so every change lands in the Lot Change Log. Uses \`requireNotBCLocked\` — on a sale already in BC that means admins only, the normal house rule.
2. **🔧 BC Corrections tab** (\`bc-corrections-tab.tsx\` + \`/api/catalogue/bc-corrections\`) — the to-do list for putting BC right. Grouped by the MOVE (old receipt/vendor → new receipt/vendor), each group listing barcode · unique ID · tote · item with a per-row tick box, Tick all / Untick all, a Hide-ticked-off toggle, and outstanding groups sorted first. Shared worklist, not per-user.

**⬆ Check against a BC export (2026-08-03).** After working through BC, upload a BC **"Lines"** export on the tab to prove the transfers landed. Parsed **in the browser** with \`xlsx\` — nothing is uploaded. Per correction it reports ✓ done in BC / ✗ still on the old receipt / ⚠ on something else (showing what BC has) / ? not in the export, as summary chips plus an "In BC now" column, and offers **"Untick the ones BC says aren't done"** to put the ticks right.

⚠ **Match on INTERNAL BARCODE, never on UniqueID.** A transferred item is re-sequenced under its new receipt (R008300-677 → R008584-…), so matching on the unique ID would fail for exactly the rows that *succeeded*. UniqueID is only a fallback for a lot with no barcode. Columns are read by name with fallbacks (Internal Barcode/Barcode, Receipt No./Receipt No, Vendor No./Vendor No, UniqueID) — verified against a real 641-row export.

**Built for BC's Transfer/Copy Receipt Line dialog (2026-08-03).** That dialog takes **UniqueID** as a **pipe-separated** filter (R008300-677|R008300-678|…) plus a **Target Receipt No.**, so each group header carries two copy buttons: **⧉ Copy N IDs** (the still-to-do rows' receiptUniqueId joined with "|"; falls back to the whole group once everything is ticked so it never copies an empty string) and **⧉ R008584** (the target receipt). Uses \`navigator.clipboard\` with a hidden-textarea + execCommand fallback, since the clipboard API needs a secure context. Lots with no unique ID can't go in the filter — the header says how many were left out rather than quietly copying a short list.

⚠ THE BC MATCH RESULT LIST IS CAPPED AT 1,000 ROWS AND THE CAP IS ORDERED BY WHAT MATTERS (fixed 2026-08-19 - Jordan: "its flagging 3 as receipt disagrees but when you click on it it says nothing to show"). It used to be a flat slice(0, 1000) in export order, so on a big export the three mismatches sat past row 1,000: the tile counted them (counts come from the full pass) while the list they opened was empty. matchBcLinesAcrossAuctions now keeps MISMATCHES FIRST (up to 500), then not-found (300), then matches in whatever room is left. ⚠ Counts are always computed over EVERY row - never derive a count from the capped rows array. The panel also says "showing the first N of M" when a group still overflows.

⚠ **The list is LIVE, not a leftover of Match BC** (fixed 2026-08-03 — Jordan: *"I need to be able to do that before I do the match so I can check back after"*). v1 only showed rows the button had written, so the tab was empty exactly when it was needed. It now merges TWO sources on \`lotId\`: **live mismatches** recomputed on load via \`checkLot\` (only receipt_mismatch / vendor_mismatch — a blank was never pushed to BC), and **saved CatalogueBcCorrection rows**, which is what keeps a row on the list AFTER the Hub has been corrected and the live mismatch no longer exists. A saved row wins the merge (it holds the tick and the values from when the discrepancy was real); rows whose live mismatch has gone show "· Hub corrected".

⚠ **\`setBcCorrectionDone\` is keyed on the LOT and UPSERTS**, not on a row id — most rows are live with no saved row until ticked, and ticking is what first records them. The snapshot is written **on create only**: a row Match BC already wrote holds the values that were real then and must not be overwritten by whatever the lot says now.

Table \`CatalogueBcCorrection\` (**NEEDS Run Migrations**), \`@@unique([auctionId, lotId])\` so both the button and a tick upsert rather than duplicate, and **\`done\` is deliberately left alone on update** so a Match BC re-run can't resurrect ticked-off work. \`lotId\` is deliberately NOT a relation — deleting a lot must not delete the reminder that BC still holds its wrong receipt.

⚠ **Only a MISMATCH creates a correction row**, never a blank being filled in — nothing wrong was pushed to BC for a value we never had.

⚠ **\`receiptUniqueId\` is NOT re-minted** by the button. It is an identity field (AI runs, receipt matching, anything already in BC) and rewriting hundreds as a side effect of a tidy-up is a separate deliberate decision — RULES → Lot Identifiers. A corrected lot can therefore still report unique_id_mismatch; that is honest, not a bug.

⚠ **Two traps handled on purpose — don't undo them:**
1. **Prisma \`in\` is case-sensitive** and totes get hand-typed, so the route queries every casing the lots actually use (raw + upper + lower), indexes by lowercase, and compares everything trimmed + lowercased.
2. **A stale sync must not read as hundreds of mistakes** — tote_unknown is amber rather than red, and the header shows when WarehouseTote was last pulled from BC (from \`max(syncedAt)\`) with a pointer to BC Warehouse → Data Sync.

## 🏷 Change Vendor (Manage Lots → Tools, 2026-08-03)

**Replaced "⟳ Pull Vendor/Receipt from Totes".** The old button only filled **blanks** (\`lot.vendor || tote.vendor\`), so it could never correct a wrong vendor, and it read the **internal** warehouse tables (WarehouseContainer → WarehouseReceipt → contact) rather than the BC tote data the wizard actually uses — so it silently skipped totes that only exist in BC.

The new one: tick the lots → **🏷 Change Vendor** → type a **tote OR a receipt** → \`lookupToteOrReceipt\` reads WarehouseTote and shows the receipt + vendor no + vendor name → apply. \`setLotsVendorReceipt\` writes vendor/receipt through \`updateLotLogged\` (source "vendor_change"), records a \`recordBulkUndo\` entry so it's reversible, and honours requireNotBCLocked.

- ⚠ **Selection-only — deliberately NO "else the whole auction" fallback** (unlike the description tools). Moving every lot in a sale onto one vendor by a mis-click isn't a mistake worth making easy.
- ⚠ **Existing receiptUniqueId is preserved**; one is only minted ({receipt}-N via maxReceiptSuffix) where a lot hasn't got one.
- A receipt with more than one vendor across its totes is **refused** with an explanation rather than picking one at random.
- ⚠ **\`fillLotsFromTotes\` is now unreferenced** — nothing calls it; RULES was updated to point at the new button. Don't wire it back up without deciding which of the two tote sources is meant.

## ⚠ The auction tab strip

Adding "🧾 Vendor / Tote Check" tipped the strip into overflow and drew a scrollbar across the tabs ("what are these ugly bars"). Two causes, both fixed:
- **\`scrollbar-none\` was never defined** — Tailwind v4 has no such built-in and this repo is CSS-first with no config file, so the class the strip had always carried did nothing. Now declared as an \`@utility\` at the bottom of \`app/globals.css\`. \`databases-client.tsx\` used the same phantom class.
- The strip now **wraps instead of scrolling** (\`flex-wrap\`, 2026-08-03): with 14+ tabs it overflows a normal window, and a *hidden* horizontal scroll just loses the last tabs off the edge where nobody finds them. Keep new tab labels short anyway.`,
  },
  {
    filename: "lot_wizard_resume.md",
    content: `---
name: Lot Wizard — Resume an unfinished lot (REMOVED)
purpose: Record that the Resume/draft feature was deliberately removed. Read before considering anything draft-shaped in the wizard.
last_updated: 2026-08-07
---

# Resume an unfinished lot — REMOVED (2026-08-07)

**Jordan had the whole feature removed** ("it seems very buggy") on 2026-08-07, a week after it was built (2026-07-31). Stripped out of \`lot-wizard-tab.tsx\`: the \`draftOffer\` state + amber "↩ You have an unfinished lot" banner, the debounced autosave, \`resumeDraft\`/\`discardDraft\`, and the post-save clear; the three server actions (\`saveLotDraft\`/\`getLotDraft\`/\`clearLotDraft\` + \`LotDraftFields\`) were deleted from \`lib/actions/catalogue.ts\`. Removal comments mark both sites.

**What remains:** the \`CatalogueLotDraft\` table and its migration SQL (migrations are append-only; the table sits inert with old rows). The wizard is back to pre-2026-07-31 behaviour: a crash or closed page loses the in-progress lot; only Tote/Vendor/Receipt survive (per-account \`saveLastLotFields\`).

**Do not rebuild this without discussing it with Jordan.** The removed design, for the record: one draft row per user per sale, server-side (survives switching iPads), photos deliberately excluded (count only + "you'll need to take them again" warning), banner-not-modal, timing restarted fresh on resume.`,
  },
  {
    filename: "lot_wizard_warnings.md",
    content: `---
name: Lot wizard input warnings
purpose: The lot wizard's sanity warnings AND its Guide/Help modal. Read before touching goNext()/validateStep in lot-wizard-tab.tsx.
last_updated: 2026-07-16
---

# Guide / Help modal (2026-07-16)

app/(app)/tools/cataloguing/auctions/[id]/cataloguing-guide.tsx — **CataloguingGuideButton**, a **modal** (not a page, so it opens mid-lot without losing the entry in progress). Rendered in the **tablet** header (tablet-tabs.tsx, left of the {lots.length} lots count, where Jordan asked for it). The **desktop Auction Manager does NOT have it** (different header, different tab set).

It covers **all four tablet tabs**, not just the wizard — its own in-modal tab bar mirrors the real one (📋 Lots · ➕ Add Lot · 📷 Photo Only · 🔍 Review) and it **opens on whatever tab the user is already on** (currentTab={tab} from tablet-tabs). Emoji + coloured callouts mirroring the real on-screen amber/red warnings. Was briefly lot-wizard-guide.tsx / LotWizardGuideButton (wizard only) — renamed when Jordan asked for per-tab sections.

⚠ **It documents real behaviour** — required fields per validateStep, what each warning means, that nothing saves until Save on step 8, that Save drops you back to step 2 with tote/vendor/receipt still locked, and that Lots search matches barcode/title/vendor/tote. **If you change lot-wizard-tab.tsx, photo-only-tab.tsx, review-tab.tsx or the Lots list, update the guide too — a guide that is quietly wrong is worse than no guide.**

⚠ **Do NOT re-add a note about Review bypassing the BC lock.** A "You can always fix things here / Review still works even after a sale has gone to Business Central" callout was written into the Review section and **Jordan asked for it to be removed (2026-07-16)**. The *code* behaviour is unchanged and still deliberate (RULES.md — the three Review actions skip requireNotBCLocked); it simply is not something to advertise to cataloguers in the guide.

Tone: plain and respectful. Jordan's brief was "the people using this are idiots so it needs to be really simple" — that means **simple**, not condescending. Never echo that framing into the product; the cataloguers are the ones reading it. Never blame the cataloguers.

## ⚠ JSX gotcha this exposed — applies to the WHOLE codebase, not just the guide

**A space between \`</strong>\` and following text that wraps to the next source line is DROPPED in the built output.** Next compiles JSX with **SWC**, which trims it even though the source clearly has a space (Babel would keep it). It shipped "All cataloguersnarrows", "Tap any lot to open itand", "Use the list.Type something…" — 7 instances across the guide, in prose that read perfectly fine in the editor.

- **Fix / always write:** \`<strong>Bold bit</strong>{" "}\` then the text on the next line. \`{" "}\` is an explicit expression and cannot be stripped. (The lines that survived were the ones already using \`{" "}\`.)
- ⚠ **It is inconsistent** — some multi-line \`</em> text\` kept its space. Don't reason about the rule; **check the rendered DOM.**
- **How to find them all** (any page, browser console) — by eye you WILL miss most:
  \`document.querySelectorAll('strong, em').forEach(el => { const n = el.nextSibling; if (n?.nodeType === 3 && /^[A-Za-z]/.test(n.textContent)) console.log('GLUED:', el.textContent, '→', n.textContent.slice(0,30)) })\`
- **tsc --noEmit cannot catch this** — it is valid TypeScript and valid JSX. Only rendering it does.

# Lot wizard input warnings (2026-07-02, duplicate barcode added 2026-07-16, STAGING)

goNext() stop-and-warn guards in lot-wizard-tab.tsx, following the existing step-1 length / step-2 barcode warning pattern (amber box; state cleared on field edit and goBack; the Next button is disabled while one is showing; shared component so desktop AND tablet get them):

- **Step 2 — "Barcode already assigned" (2026-07-16):** on Next, a **live server check** asks whether the barcode is already on a lot **ANYWHERE in the app** (every auction, not just this one). If so, a **RED** box (deliberately not the house amber — the others are heuristics, this one is a fact) names the lot, which auction it's in, who catalogued it and its unique ID, offering **"Change barcode"** and **"Continue anyway"**. Checked **BEFORE** the wrong-auction prefix warning — an exact match against a real lot beats a prefix guess. Next shows "Checking…" and is disabled during the lookup.
  - ⚠ **Jordan explicitly required this be live, "not based off a refresh".** A first pass checked a client-side existingLots prop of the loaded lots; it was **removed** because a stale client cannot see a lot another cataloguer created seconds ago on another device — exactly when a duplicate gets minted. **Do not reintroduce a client-side version.**
  - **checkBarcodeAssigned in lib/actions/catalogue.ts uses RAW SQL on purpose — keep it that way.** Prisma's mode: "insensitive" compiles to **ILIKE, which Postgres cannot serve from a btree index**, so the obvious findFirst version sequentially scans every lot ever catalogued **on every press of Next**. It uses LOWER(col) = LOWER($1) to match two **functional indexes** (CatalogueLot_barcode_lower_idx, CatalogueLot_receiptUniqueId_lower_idx, **NEEDS Run Migrations**), which live **only** in the run-migrations list because Prisma has no schema syntax for expression indexes. CatalogueLot.barcode / receiptUniqueId had **no index at all** before this.
  - Matches on **BOTH** barcode AND receiptUniqueId (the box accepts either format — RULES.md → Lot Identifiers; either landing twice = the same physical item twice). ORDER BY createdAt ASC so it names the original, not an arbitrary row.
  - **Returns, never throws** (thrown server actions are redacted in production). A failed check gets its own amber box ("Try again" / "Continue anyway") and **never silently continues** — that would wave through the duplicate it exists to catch — but never hard-blocks cataloguing on an outage either.
  - ⚠ **It is a WARNING, not a block — this is deliberate.** Jordan was offered a hard block for non-admins on 2026-07-16 and said: *"No its fine I want the option."* A cataloguer can knowingly continue and create the duplicate. **Do not "tighten" this into a block.**
  - Separate from, and additional to, the pre-existing **lastSavedBarcode** guard (refuses to re-save the immediately-previous barcode — stops a stuck/continuous-mode scanner minting duplicates).

- Step 5 (estimates): if Low > High (values already validated numeric) a warning says they look the wrong way round, with three buttons — "Swap them & continue" (one-tap swap, straight to step 6), "Fix it" (close the box), "Continue anyway". Equal low/high is deliberately allowed (single-figure estimates are legitimate).
- Step 4 (categories): if a hand-typed Main or Sub category is not EXACTLY in the preset list (useCategoryMap — the DB-managed Admin -> Cataloguing Categories list that mirrors BC), a warning says it won't match up in BC. Main is checked before Sub (the sub list depends on a valid main); blank categories never warn (they're optional). If only the capitalisation differs from a preset, a one-tap 'Use "<preset>"' button corrects it. A sub typed under an invalid main gets re-checked once the main is fixed.`,
  },
  {
    filename: "idle_timer_redesign.md",
    content: `---
name: Idle timer — on-lot-start, working hours, per-user config
purpose: How the cataloguing idle timer works after the 2026-07-02 redesign. Read before touching the lot wizard's timing/idle code, the idle-timer admin page, or per-user scan-timer settings.
last_updated: 2026-07-02
---

# Idle timer redesign (2026-07-02, STAGING)

Jordan's complaints about the old design: the popup appeared spontaneously (intrusive), ignored popups stacked into the next lot's timing, and overnight/weekend gaps counted. The rework (lot-wizard-tab.tsx + lib/idle-timer-config.ts):

## Behaviour
- NO more 30-second polling / visibility-change popup. The idle question fires ONLY when a NEW lot's timing starts — checkIdleOnLotStart() inside startLotTiming(), the single entry point that replaced both places that set barcodeStartedAt (barcode first character + Next Barcode button). The popup shows a FIXED duration; it no longer ticks while open.
- WORKING HOURS ONLY: workingMsBetween(start, end) in lib/idle-timer-config.ts sums overlap with Mon-Fri 09:00-17:00 local time (WORK_START_HOUR / WORK_END_HOUR). Day-iteration via Date objects so DST is handled; unit-tested including weekend and DST cases. Fri 16:30 -> Mon 09:20 = 50 minutes. A gap of 8+ WORKING hours (holiday, long absence) is silently skipped and the baseline reset.
- CROSS-DEVICE TRUTH: before accusing anyone, the check calls GET /api/catalogue/last-activity (max of the user's latest CatalogueTimingLog.savedAt and IdleLog.createdAt — their real last activity on ANY device) and takes the max with the local heartbeat. This kills the false positive where someone lots on the desktop all day and the iPad then accuses them of 7 hours idle. If the fetch fails it falls back to the local heartbeat.
- BASELINES: lastActivityRef starts at 0 — page-open time is deliberately NOT activity, so a fresh browser / brand-new starter is never asked (the first check just seeds the baseline quietly). The localStorage heartbeat key is per-user (vectis_idle_last_activity_<userId>). bumpActivity(ts) writes ref + heartbeat and is called on lot save, on idle submit, on the 8h silent skip, and on sub-threshold lot starts (so a mid-lot page reload doesn't over-count the next gap).
- The popup's time no longer pollutes the next lot's duration: submitIdleLog re-baselines barcodeStartedAt + timerSecs after the reason is submitted.

## Config — ONE place, ONE number
- Timing is a SINGLE per-user threshold: User.timerRedMins, the "Warn after (mins)" field in Admin -> Users -> (user) -> Scan timer. The lot timer goes teal -> red at that many minutes AND the same value is the idle threshold. **House default is 30 mins** (was 10; changed 2026-07-21 — schema @default(30) + an ALTER SET DEFAULT 30, plus a one-time idempotent backfill (OneTimeBackfill key timerRedMins_10_to_30_20260721) that bumped everyone still on 10 to 30 without stomping custom values). The yellow stage was removed (same-day follow-up): User.timerYellowMins REMAINS in the DB but is unused — deliberately no schema change (User-table columns are a login-lockout risk per RULES); the settings API still accepts it harmlessly. The timerYellowMins prop was removed from LotWizardTab / AuctionTabs / TabletTabs and both pages' user selects.
- The Admin -> Idle Timer page is REASONS-ONLY — IdleTimerSettingsClient takes initialReasons; PUT /api/admin/idle-timer-config accepts { reasons } only (empty list rejected; the client blocks deleting the last reason; legacy yellow/red columns remain in the row but are not edited).

## ⚠ Gotchas
- The TABLET path must pass userId/userName to LotWizardTab (tablet page -> TabletTabs -> wizard). It originally didn't, which made the per-user heartbeat key fall back to a shared key on the shared iPad — cataloguer B got blamed for A's gap. Found by a 3-reviewer verify workflow; keep the prop threaded.
- KNOWN TRADE-OFF (deliberate, flagged to Jordan): walking away MID-LOT is no longer questioned — that time lands in the lot's CatalogueTimingLog.durationMs and shows as a slow lot in reports. Do NOT clamp lot durations with working hours (staff may legitimately catalogue outside 9-5, and report maths changes need verification per the phantom-counts entry).`,
  },
  {
    filename: "accounts_transfer.md",
    content: `---
name: Accounts — Transfer between environments
purpose: Export/import ALL Accounts data (rows + R2 scan files) between staging and production. Read before touching the transfer routes or changing any Accounts schema field (the transfer field-allowlists must be kept in step).
last_updated: 2026-07-02
---

# Accounts — Transfer between environments (2026-07-02, STAGING)

A "Transfer between environments" collapsible card on /tools/accounts (transfer-data.tsx) moves ALL Accounts data between staging and production (separate databases). ADD-ONLY like the instructions import: rows keep their original ids, anything already present is skipped, nothing is ever overwritten or deleted — safe to re-run.

## How it works
- Export: GET /api/accounts/transfer/export (admin) downloads vectis-accounts-<date>.json — every cardholder, supplier rule, month, document, statement and transaction with original ids (so BankTransaction.matchedDocIds keep pointing at the right lines), PLUS files:[{key,url}] — a 24-HOUR signed R2 URL for every scan/statement image. Import within 24 hours or the file links expire (rows still import; re-export for the files).
- Import: POST /api/accounts/transfer/import (admin). Cardholders keyed by NAME, supplier rules by match, months by id (a unique-label clash imports with an " (imported)" suffix and a note), documents/statements/transactions by id — existing ids are skipped; rows whose parent month/statement is missing are skipped with a note. All fields allowlisted and dates revived.
- Files: POST /api/accounts/transfer/import-files (admin, chunks of up to 10). For each key: if the object already exists in THIS environment's R2 it is skipped, otherwise it is downloaded from the signed URL and uploaded under the SAME key. This works whether or not the environments share an R2 bucket — shared bucket means every file reports "exists" and nothing is copied. The client loops the chunks with a progress bar; per-file failures are reported with re-export-and-retry guidance (already-copied files skip on the retry).

## Supporting changes
- lib/r2.ts: new objectExistsInR2(key) (HeadObject); getSignedImageUrl(key, expiresIn = 3600) gained an optional expiry parameter (default unchanged).

## Gotchas
- To move staging → production, the feature must exist on production too (merge to main first). Export on staging, download the file, then import it on production's /tools/accounts.
- If a new column is added to any Accounts model, ALSO add it to the export payload and the import field-allowlist, or transfers will silently drop it.`,
  },
  {
    filename: "bc_oauth_connect.md",
    content: `---
name: BC OAuth connect — per-user token + warehouse banner
purpose: How the per-user Business Central sign-in works, the ?return= flow, and the BC Warehouse connect banner. Read before touching /api/bc/auth, /api/bc/callback, or any tool that queries BC with the user's own token.
last_updated: 2026-07-02
---

# BC OAuth connect — per-user token + BC Warehouse banner (2026-07-02, STAGING)

BC sign-in is PER-USER: a BCToken row per userId. getBCToken() = the current user's own token (auto-refreshed via its refresh token); getBCTokenAny() = any valid token in the DB (warehouse sync + cron use). The BC Warehouse background sync piggybacks on ANY token, but the live-query tabs — Location History, Collections Due, Unsold Items (and the sale-checklist auction-name backfill) — query BC as the CURRENT user and fail if they have never signed in.

## The problem this fixed
The only "Sign in with Microsoft" prompt lived in BC Reports — which a user with only BC_WAREHOUSE access cannot open (its layout redirects them to /hub) — and /api/bc/callback hardcoded every redirect back to /tools/bc-reports. So a warehouse-only user could NEVER connect.

## How it works now
- /api/bc/auth accepts an optional ?return=<internal path>. Validated by safeReturnPath (must start with "/", not "//", no scheme/query/dots — open-redirect safe) and carried in a bc_oauth_return cookie (5 min) beside the state cookie.
- /api/bc/callback redirects ALL outcomes (success ?bc_connected=1, ?bc_error=..., invalid_state) to that path; default stays /tools/bc-reports so the old flow is unchanged. Both cookies are cleared on redirect.
- safeReturnPath is deliberately DUPLICATED in both route files — Next route files may only export HTTP handlers, so it cannot be exported from one and imported by the other.
- BC Warehouse page shell: fetches /api/bc/status on load (= does the CURRENT user have a valid/refreshable token). When false, a blue "Connect to Business Central" banner appears at the top with a "Sign in with Microsoft" button linking to /api/bc/auth?return=/tools/bc-warehouse. On return, a green connected / red error notice is shown from the query params, which are then stripped with history.replaceState.
- The BC Warehouse guide entries (home, location-history, collections-due, unsold-items, data-sync) mention the banner — keep them in step.

## Pattern for other tools
Any BC-dependent tool whose users may lack BC Reports access should offer its own connect link: /api/bc/auth?return=<its own path>.

The **Manager Portal** does this (2026-07-21): manager-portal-table.tsx shows a "🔗 Connect to Business Central — Sign in with Microsoft" banner (→ /api/bc/auth?return=/tools/manager-portal) when /api/manager-portal/bc-counts returns {connected:false}, plus a green/red notice from ?bc_connected/?bc_error on return. Added because a manager who only uses the portal saw all-0 BC figures with no way to sign in.

**Global BC button in the top bar** (2026-07-21): components/bc-status-button.tsx (in top-bar.tsx, shown to everyone) — a small "BC" badge + status dot (green/amber/grey) that checks /api/bc/status on mount; clicking opens a popover with a "Sign in with Microsoft" button → /api/bc/auth?return=<current path>. So anyone can connect BC from any page.`,
  },
  {
    filename: "bc_warehouse_guide.md",
    content: `---
name: BC Warehouse — Guide tab + PDF guides
purpose: In-app user guides for every BC Warehouse section with per-section PDF downloads. Read before changing any BC Warehouse tab (the guide must be kept in step) or the guide/PDF code.
last_updated: 2026-07-02
---

# BC Warehouse — Guide tab + per-section PDF guides (2026-07-02, STAGING)

User guides for every BC Warehouse section, in-app and downloadable as branded A4 PDFs. Content was written from a full multi-agent read of each tab's code (one reader per tab), so it documents actual behaviour.

## Where things live
- Content SINGLE SOURCE OF TRUTH: lib/bc-warehouse-guide.ts (GUIDE_SECTIONS — id/title/icon/intro/dataSource/shows/controls/howTo/tips/gotchas per section; ids match the page's Tab ids). Both the Guide tab UI and the PDF route render from it — edit there and both stay in step. ⚠ If you change a BC Warehouse tab's behaviour, update its guide entry in the same change.
- Guide tab UI: app/(app)/tools/bc-warehouse/guide-tab.tsx, wired into page.tsx (Tab type + tabs list "Guide" entry + a HOME_CARDS card). Left section list, content sections (intro, data-source callout, What you'll see, Buttons & controls, How to, Tips, Watch out for), and a per-section Download PDF button. The initialId prop follows the floating ?; it uses the state-adjust-during-render pattern, not setState-in-an-effect (eslint blocks that).
- Floating "?" button: rendered by the PAGE SHELL as an overlay (absolute bottom-right in the content wrapper, shown on every section except home/guide) and jumps to that section's guide. Deliberately an overlay so it touches NO tab's internals — the Location History do-not-change rule stays honoured.
- PDF route: GET /api/bc/warehouse-guide-pdf?section=<id>, gated by session + hasAppAccess BC_WAREHOUSE (mirrors the layout gate). Renderer in lib/bc-warehouse-guide-pdf.ts — pdf-lib + embedVectisLogo (lib/pdf-logo.ts), A4 portrait, branded first-page banner, running header on continuation pages, cursor-based Writer with automatic page breaks and page numbers, WinAnsi-safe text (emoji stripped; arrows/ticks/warning signs mapped to ASCII).

## Gotchas
- The Writer class uses explicit constructor field assignments, NOT TypeScript parameter properties — parameter properties are non-erasable TS and break Node's native type-stripping, which is used to test the builder standalone (all 11 sections were rendered to 2-page PDFs as a real test before shipping).
- PDF filename: bc-warehouse-guide-<id>.pdf. Unknown ?section returns 404 with the list of valid ids.`,
  },
  {
    filename: "accounts_simple_mode.md",
    content: `---
name: Accounts — Simple mode + ACCOUNTS app
purpose: Tablet/mobile hand-holding version of the Accounts tool for a non-technical staffer, and the access change that lets them in. Read before touching Accounts access or the wizard.
last_updated: 2026-07-02
---

# Accounts — Simple mode (guided) + ACCOUNTS grantable app (2026-07-02, STAGING)

A big-button, one-screen-at-a-time version of the Accounts tool for a non-technical staff member. Whole job, guided: capture -> AI read -> check each receipt -> match statement -> finish/export. NO schema change, so NO migration needed — it is a new front-end + an access change over the existing backend.

## Access
- ACCOUNTS is now a proper app: added to AppKey + ALL_APPS in lib/apps.ts, and the existing Accounts hub card in lib/app-cards.ts gained appKey ACCOUNTS. Grant it to the one staffer in Admin -> Users & Permissions (the checkbox appears automatically). Admins still auto-see everything.
- lib/accounts-auth.ts: getAccountsAccess() returns { session, canAccess, isAdmin }; requireAccountsAccess() throws if not allowed. Admins always pass; a non-admin passes only if granted the ACCOUNTS app (reads allowedApps from the DB). Session is typed as Session from next-auth (NOT Awaited<ReturnType<typeof auth>>, which resolves to the middleware overload and will not compile).
- Routes the wizard needs now gate on accounts-access (were admin-only): upload, extract, apply, statement/upload, statement/parse, export. The other accounts routes (split, stitch, add-page) stay admin-only.
- In lib/actions/accounting.ts a new requireWizard() (= requireAccountsAccess) loosens EXACTLY 5 actions: saveAccountingDocuments, deleteAccountingDocument, setTransactionMatch, setTransactionReceiptMissing, autoMatchStatement. Everything else keeps requireAdmin() (month/cardholder management, reserves, move-between-months, CSV import, deleteBankStatement, snapDocAmount, setTransactionIgnored, setStatementCardholder, clearStatementMatches).

## Routing / the toggle
- /tools/accounts (full table) shows a "Simple mode" button for admins; non-admins are redirected to /tools/accounts/simple.
- The complex pages ([monthId], [monthId]/reconcile, reserves) switched their gate to getAccountsAccess and funnel non-admins to /tools/accounts/simple/[monthId] (or /simple). The full table/reconcile/reserves stay admin-only-view.
- New files: simple/page.tsx (friendly month picker; favourite month = "Working on this now"), simple/[monthId]/page.tsx (server loader, same data + signed URLs as the month + reconcile pages), simple/[monthId]/wizard-client.tsx (the guided flow).

## The wizard (wizard-client.tsx, all client, reuses existing routes/actions + the shared ImageViewer)
Home overview with 4 tappable step cards (progress/counts), then linear sub-flows: Capture (camera-first upload with capture=environment + Choose files; pick the card once, persisted in localStorage accounts_cardholder), Read (loops unread SCAN docs through /api/accounts/extract then /api/accounts/apply — same path as the admin client so multi-receipt photos + category splits work — with a progress bar), Review (one receipt at a time: photo + plain-English summary, Looks right / Change something (big fields, VAT as 3 buttons) / Remove; VAT recomputed only when gross or vatCode change), Statement (per card: upload+read, existing statements listed with match progress), Match (one payment at a time: exact-amount suggestions, smart-match subset-sum, show-other-receipts, No receipt, Skip — ports buildUnits/findCombo/statementState from reconcile-client), Done (summary + missing-invoices email + export link). Mutations use optimistic local state + router.refresh() (pages are force-dynamic so refresh re-pulls fresh data). A just-read statement shows a loading state until its transactions load, to avoid a false "all sorted" flash.`,
  },
  {
    filename: "reference_phantom_catalogue_counts.md",
    content: `---
name: Phantom Cataloguing Counts
purpose: Inflated cataloguing report counts — root cause, fix, ruled-out theories. Read before touching cataloguing reports or the lot wizard.
last_updated: 2026-07-01
---

# Phantom cataloguing report counts

Symptom: lots counted into sales that have no real lots (e.g. X069), inflating everyone's counts on /tools/reports; the barcode column showed wrong numbers; rows appeared as "deleted lot".

## DO NOT blame the cataloguers — hard rule
Jordan was adamant (and present in person): the cataloguers are NOT manually creating these lots. Nobody uses X069; its change log is empty. Never say the users are doing it themselves. Also ruled out:
- Barcode scanner — not used ("too slow"). Not the cause.
- X-vs-F auction-code prefix — RED HERRING. The ID regexes accept any letter, and every prefix check uses the actual auction code, not a hardcoded F. An X sale behaves identically to an F sale (confirmed by a full code scan on 2026-07-01).

## Root cause (code)
1. CatalogueTimingLog.lotId is a loose String with NO foreign key to CatalogueLot. Delete a lot and its timing log is orphaned but still counts and shows.
2. The lot wizard step 8 (Save) had no validation — validateStep only covered steps 1, 2, 5, 7, so any activation of Save minted a lot from whatever was on screen. The external activator that presses Save on the tablet is still UNKNOWN; activation-log instrumentation is live (getSaveAttempts, fed by /api/catalogue/save-attempt). Both desktop + tablet use the same instrumented LotWizardTab, so tablet saves are logged. Enriched 2026-07-01: also logs auctionCode, barcode value, userAgent + maxTouchPoints (device), and the viewer red-flags suspicious rows (untrusted / synthetic / incomplete / X069 / repeated barcode). RESOLVED: pointerType=mouse is a red herring — iPad Safari synthesizes mouse events for finger taps (WebKit bug 214609), so trusted + detail 1 + mouse = a normal human tap. Rely on the other red flags (untrusted / synthetic / incomplete / X069 / dup barcode), NOT pointer type.

## The fix (live on production, main == staging on 2026-07-01)
- Wizard saveLot validates the whole wizard before creating; refuses the same barcode, or a save under 3s after the last.
- createLot server backstop rejects a duplicate barcode in the same auction within 60s.
- deleteLot and transferLots delete/move timing logs alongside lots in a transaction.
- Admin tooling under /tools/reports: removeOrphanedTimingLogs (delete existing orphans), inspectOrphanedTimingLogs (read-only), and an activation log viewer.
- Reports filter orphans at query time: lib/cataloguing-reports.ts buildLotMap looks up lots by id across the whole table, and both reports pages keep only logs whose lot still exists (or that have no lotId). Only truly-deleted lots are dropped, so real work is never under-counted.

## 2026-07-01 — full /tools/reports code review (13 fixes, on staging)
An adversarial review found 13 confirmed issues; all fixed on staging, verified numerically-equivalent to the old stats. Durable rules:
- Manager Portal ALSO counted phantoms (plain groupBy, no orphan filter) — now raw SQL with the same exclusion. ANY new place that counts CatalogueTimingLog must exclude orphans with (t."lotId" IS NULL OR EXISTS (SELECT 1 FROM "CatalogueLot" l WHERE l."id" = t."lotId")).
- Overview stats now computed in orphan-aware SQL (not by loading every row) — don't revert to row-loading, "All time" would OOM/crash.
- Day/week/month bucketing is Europe/London (not server UTC). Reuse ukDayKey / ukDayStartUtc / minOf / maxOf from lib/cataloguing-reports.ts (never Math.min(...bigArray)).
- Reports pages re-assert hasAppAccess(..., "REPORTS") via getEffectiveSession() and gate the admin cleanup button on the effective (impersonation-aware) role.
`,
  },
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

## ⚠⚠ THE CACHE HAD NO DELETE PATH UNTIL 2026-08-19 — ROWS DELETED IN BC LIVED HERE FOREVER

Every sync/* stage is UPSERT-ONLY, deliberately, so a partial walk can never wipe good data. The cost: a row DELETED in BC stayed in WarehouseItem indefinitely. Found when Jordan put BC's own Receipt Lines screen beside ours - receipt R008537 returns 50 rows from live BC, our cache held 143. The 93 ghosts were temp A995 lines BC deleted when the items were re-receipted, and their barcodes had since been reused on OTHER CUSTOMERS' lots - which is how a search for one customer's tote showed another customer's items in the Admin Centre. ~1,800 A9xx rows cache-wide had the same shape.

POST /api/warehouse/sync/reconcile-deleted - Data Sync STAGE 8, and the tail of the nightly cron/bc-warehouse. For each SUSPECT receipt (any holding at least one A9xx row) it asks LIVE BC what that receipt actually contains and deletes the cached rows BC no longer has.

⚠ IT IS THE ONLY STAGE ALLOWED TO DELETE, so the rules are strict and must stay: SUSPECTS ONLY (never a whole-table sweep deciding what to kill); LIVE BC IS THE SOLE AUTHORITY (never a heuristic, never our own cache); AN EMPTY ANSWER DELETES NOTHING (a receipt returning no rows is skipped and counted - "delete everything" must never ride on a response that may simply have failed); A FETCH ERROR STOPS THE RUN rather than skipping on. Same contract as the other stages so the Data Sync stage loop drives it unchanged.

## ⚠ "WHO CATALOGUED IT" LIVES IN THREE BC FIELDS - THE OBVIOUS ONE IS USUALLY EMPTY

EVA_CataloguedBy is a short CODE ("KS") and is blank on tens of thousands of lines. EVA_CataloguedByUser and EVA_CreatedBy carry a WINDOWS USERNAME ("ANNABELL.FENBY"). Measured on 200 catalogued receipt lines whose EVA_CataloguedBy was blank: 98 had CataloguedByUser, ALL 200 had CreatedBy. Synced onto WarehouseItem.cataloguedByUser / bcCreatedBy; resolved by bcPersonName() in lib/cataloguer-directory.ts (code through the directory, then username matched on the directory's EMAIL local-part, then title-cased).

⚠ receiptTotes (eva/tot custom API) field names, READ OFF A LIVE ROW: receiptNo, toteNo, vendorNo, articleCategory, articleSubcategory, articleSubcategory2, contentsDescription, catalogued, cataloguedAt, cataloguedBy, toteLocation, systemCreatedAt, reserveStatus, reservePrice. camelCase, unlike the EVA_-prefixed Excel feeds.

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
- **EVA_CFA_TOT_CreatedFromToteNo = the item's SOURCE TOTE (✅ populated, incl. old receipts — verified 2026-07-29). The real item→tote link; EVA_ArticleToteNo is empty on ~all rows. Synced into WarehouseItem.toteNo.** No SystemCreatedAt on this feed (only EVA_SystemModifiedAt); EVA_GoodsReceivedDate exists but is empty in practice (0 of ~208k rows).

### Auction_Receipt_Lines_Excel
- Auction code: EVA_SalesAllocation (same as Receipt_Lines_Excel)

### Receipt_Totes_Excel (BC's ACTIVE-totes feed — SMALL, low thousands of rows)
- Category: **EVA_TOT_ArticleCategory** · Tote no: EVA_TOT_ToteNo / EVA_TOT_No · Receipt: EVA_TOT_ReceiptNo · Location: EVA_TOT_ToteLocation · Cataloguer initials: EVA_TOT_AssignToCataloguer
- Check-in date: **SystemCreatedAt** (guard BC empty-date 0001-01-01 → treat < 1990 as no date)
- **⚠⚠ MEASURED (direct full pull): ~1,780 rows total; \`$skip\` pagination WORKS here**; natural order starts at ANCIENT backlog receipts (R000009…), so a "first 500 rows" slice looks like ancient data. The feed = current warehouse state (uncatalogued backlog + totes on/recently on benches).
- ✅ **THIS is the source for "how far behind is cataloguing per category"** (settled 2026-07-30) — it holds category + location + check-in per tote. Group by \`EVA_TOT_ArticleCategory\`, keep \`EVA_TOT_ToteLocation\` containing **BENCH** (Jordan: use the LOCATION not the flag — TRAINS 74 vs 42), newest 10 by \`SystemCreatedAt\`, median. Bench counts measured 2026-07-30: TRAINS 74, VINTAGE_DIECAST 74, BEARS 57, MATCHBOX 39, MODERN_DIECAST 34, TV_FILM 34, DOLLS 21, TOY_FIGURES 20, RETRO_TOYS 17, STAR_WARS 14, PUBLICATIONS 11, VINTAGE_TOYS 10, GAMING 9, MUSIC_MEDIA 7, TRADING_CARDS 7, COLLECTABLES 5, MILITARY 4, MODELS_KITS 4, SPORTS 2.
- ⚠ \`PTE_Benched\` is a **flow field — NEVER \`$filter\` it** (OData returns the wrong subset); test in code, or just use the location. \`EVA_TOT_CataloguedAt\` is the 0001 sentinel even on benched rows, so you can't rank by finished-time. A tote's category label can differ from its items' categories (mixed-stock receipts) — fine, since BC's own view groups by the tote's category too.
- ⚠⚠ **Never infer from the ITEM feed whether a category uses totes.** TRAINS items have \`EVA_CFA_TOT_CreatedFromToteNo\` blank, yet TRAINS has 74 benched totes here — that wrong inference cost ~10 rounds.
- **FETCH (if you must read this feed, e.g. "what's left to catalogue" counts): pull the WHOLE feed in one \`bcFetchAll(token, "Receipt_Totes_Excel")\` — NO $filter, NO $select — then group/filter IN CODE** (proven in app/api/bc/warehouse/route.ts). Do NOT $filter per-category (under-returns) and do NOT rely on server paging (BC emits no nextLink → only first 500 rows).
- Item→tote link: ✅ **\`Receipt_Lines_Excel.EVA_CFA_TOT_CreatedFromToteNo\` (the item's source tote) — CONFIRMED populated 2026-07-29 incl. old receipts**; synced into WarehouseItem.toteNo since then (full Receipt Lines re-sync backfills). \`EVA_ArticleToteNo\` is empty on ~all items — never use it; receiptNo join is the legacy approximation.

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

**Pagination — big feeds use @odata.nextLink, not $skip.** BC has a ~38k row $skip limit that breaks plain $skip paging on huge tables (Receipt_Lines_Excel 187k+) — use bcPageWithNext + follow @odata.nextLink. ⚠ EXCEPTION for SMALL feeds (low thousands, e.g. Receipt_Totes_Excel): $skip is fine and is the proven pattern — \`bcFetchAll\` pages the whole thing. Adding $top to an initial query disables nextLink emission.

**Flow/calculated fields can't be $filtered.** An OData \`$filter\` on a BC flow field (e.g. \`PTE_Benched\` on Receipt_Totes_Excel) silently returns the WRONG subset. Pull the rows and test the field IN CODE instead.

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

## Manager Portal (/tools/manager-portal) — BUILT + REDESIGNED 2026-06-30, STAGING
Manager dashboard, home card under Cataloguing & AI (app key MANAGER_PORTAL — grant access in Admin → Users; admins see it automatically). Shows how many lots are in every sale across BOTH cataloguing systems plus cataloguing pace and projected milestone dates. No schema change / no migration. Page passes nowMs from the server to the client so date maths never causes a hydration mismatch.

BC count = unique barcodes of lots CATALOGUED in BC, deduped against the Hub — the key fix. Lots get counted in BOTH systems once catalogued in BC, so a naive Hub+BC total DOUBLES. GET /api/manager-portal/bc-counts (active sales only) fetches Receipt_Lines_Excel by EVA_SalesAllocation selecting PTE_InternalBarcode + EVA_Catalogued, builds a Set of unique barcodes ONLY from catalogued rows (bc), counts lot-level overlap = Hub lots whose barcode is in that set, and returns combined = bc + (hubLots − overlap). CRITICAL: it must filter on EVA_Catalogued — counting all received lines made every Hub lot match (all were received into BC first) so Total collapsed onto the BC received count and the Hub added nothing (Jordan: F088 = Hub 406 / BC 501 / Total 501). connected:false when BC not linked; per-sale failure → "—"; 100s wall-clock budget.

Pace = Hub lots ÷ number of distinct ACTIVE days (days with ≥1 lot, from a per-day raw query). When all lots were added on one day (activeDays < 2) there's NO meaningful pace — the rail just shows a quiet "—" / "Not enough days of activity" and no milestones, instead of a fake "385/day". (An earlier amber "Bulk import" badge was removed — it's a staging-test-data artifact, not seen in production.) Projected milestones = next round-hundreds above the combined TOTAL (not the Hub count) at the Hub pace, amber if after the sale date, only when there's a real pace. (Fixed 2026-06-30: they were anchored to the Hub count, so a 627-Total sale showed 500/600 milestones — confusing.)

UI: ACTIVE sales are "control panel" CARDS — Design 2, picked by Jordan from a 3-way design+judge workflow after he called the flat version "boring, poorly laid out". 3-column top: identity (code · type · name · sale date · colour-coded days-to-sale chip) / metrics (Hub · BC · Total-deduped hero + a segmented Hub-vs-BC-only bar + "X of N Hub lots already in BC") / pace rail (big pace number + "over N active days" + a sparkline of daily lot counts, or the bulk-import badge). Click-to-expand Detail → throughput tiles + milestone ladder + top-cataloguer leaderboard. COMPLETED sales = compact ✓-tick table. The active-card UI is a scoped style block with mp-prefixed class names (deliberately not Tailwind) to reproduce the chosen design faithfully. Server computes a per-day-lot-count raw query (activeDays/pace/sparkline) + timing-log avg + top cataloguers.

## Cataloguing Reports phantom counts — tablet auto-creates lots; TRIGGER UNKNOWN (2026-06-30)
The fixable code defect: the tablet wizard created a lot on ANY activation of the step-8 Save button with NO validation (validateStep only covered steps 1/2/5/7 — no step-8 branch, so saveLot always called createLot). Whatever keeps poking Save mints a lot, stamped with the parked auction (X069) and whoever is logged into the shared iPad (rotating → "5 users"), method WIZARD, short durations, ~1s key-points. Lots removed out-of-band → orphaned timing logs (loose-lotId) → inflated report counts. Inspector proved they're real createLot calls (lotId & log id are consecutive CUIDs). ⚠ TRIGGER STILL UNKNOWN — Jordan is certain it's NOT the cataloguers (he watched) and NOT the scanner (unused). A hunt found no in-app auto-fire; an external agent activates the button (candidates: stuck/ghost iPad touch, an automation/monitoring tool, autofill). Do NOT re-blame the users or scanner. Fix (pushed, trigger-agnostic): saveLot validates the WHOLE wizard (steps 1,2,5,7) before createLot — a blank/partial save is refused (key protection); refuses to re-save the same barcode or save within 3s; plus a server backstop rejecting an identical barcode in the same auction within 60s. Instrumentation added (2026-07-01): saveLot fire-and-forgets each Save activation to POST /api/catalogue/save-attempt (in-memory ring buffer), viewable via the "🛰 Activation log" button on /tools/reports (getSaveAttempts) — shows isTrusted/detail/pointerType + whether barcode/estimate/parcel were filled. Genuine iPad tap = isTrusted:true/detail:1/pointerType:touch; synthetic/keyboard = detail:0. Read it if new phantom logs appear. Existing orphans: "🔍 Inspect" / "🧹 Remove phantom logs" on /tools/reports. Reports now also EXCLUDE orphaned logs at query time (both /tools/reports and /tools/reports/[userId] build a lotMap and filter out logs whose lot is gone), so phantom "deleted lot" rows never count/show even before cleanup.

## Home page sections (2026-06-30)
Home page (/hub) groups cards by card.group over SECTION_DEFS in lib/app-cards.ts. Added a "Reports" section right after Cataloguing & AI and moved the Cataloguing Reports (/tools/reports) and Marketing Reports cards into it (group CATALOGUING_AI → REPORTS). BC Reports stays under Business Central. Card group is not stored in the DB, so moving a card = changing its group in the static def.

## Announcements — instant delivery (2026-06-30)
One app-wide announcement (singleton Announcement row, set at /admin/announcements) shown as a sticky dismissible top bar (announcement-banner.tsx in the app layout). It already polled every 60s; users still missed it / felt they had to refresh, so the fix was to make it appear the instant it's turned on. The setAnnouncement action now emits a Socket.IO "announcement:changed" event via globalThis._io (the io instance server.js exposes), and the banner connects with io({path:"/socket.io"}) and re-fetches on that event. 60s poll kept as fallback; emit is optional-chained so it's a no-op under next dev. Kept as ONE message (no feed, no must-acknowledge modal) — Jordan only wanted instant.

## Announcements — Patch Notes popup added (2026-07-16) — NEEDS RUN MIGRATIONS
⚠ This **reverses** the "no must-acknowledge modal" decision recorded in the entry above — Jack asked for one, deliberately, so don't "restore" the old behaviour. /admin/announcements is now TWO tabs: **Banner** (the existing singleton, unchanged) and **Patch notes**. The two are different tools on purpose: the banner is ONE live message for something happening now; patch notes are a dated history of fixes/changes, added to per release.

New models **PatchNote** (title/body/published/createdAt/createdByName) + **PatchNoteSeen** (@@unique([patchNoteId, userId]), cascade) — migration 20260716140000_add_patch_notes. components/patch-notes-popup.tsx (mounted in app/(app)/layout.tsx, only when the terms gate ISN'T up — two stacked modals would be a mess) fetches GET /api/patch-notes on mount, steps through unseen notes with Next, and POSTs /api/patch-notes/seen on "Got it ✓".

- **⚠ Nothing is sent automatically — writing and sending are SEPARATE steps, at Jack's explicit request.** savePatchNote deliberately does NOT touch the published flag; new notes are always created as drafts. Only the **Push** button (pushPatchNote) publishes. Do NOT "helpfully" reintroduce a publish-on-save checkbox — that was the first cut and was rejected.
- **pushPatchNote = publish + clear the seen rows, in one transaction, on purpose.** "Push" means the same thing whether it's a first send (nobody's seen it, the clear is a no-op) or a re-send after a correction (people who read the old version get the new one). An earlier separate "Show again" button was merged into it — two near-identical buttons only invited pressing the wrong one. unpublishPatchNote ("Stop showing") pulls it back and leaves the seen rows alone.
- **Editing a note stays quiet by design** — a typo fix must not re-interrupt the whole company. Press Push if they genuinely need to re-read it.
- **Seen is per-USER in the DB, NOT localStorage** — the cataloguing iPads are shared, so a browser-level dismiss would hide a note from everyone who logs in after the first person. That's the whole reason the table exists; it is NOT an audit trail (no signature, unlike TermsAcceptance) and Jack explicitly didn't want acceptance tracking. Verified in a rolled-back transaction: bob still sees a note alice dismissed.
- **Migration-safe**: readAllPatchNotes returns a {status} union — "no-table" shows a Run Migrations hint, "error" shows the REAL error (a dead DB must not be mis-sold as a missing migration, same reasoning as the message-matching in app/api/bc/cataloguing/route.ts); readUnseenPatchNotes returns [] so the popup silently shows nothing. Code deploys before the button is clicked — don't remove those catches.
- POST /api/patch-notes/seen filters ids to notes that still exist before createMany: createMany is atomic, so one deleted note would fail the batch on the FK and leave the user's other notes unmarked forever. skipDuplicates only covers the unique index, not the FK.
- No socket/poll, unlike the banner: a patch note isn't urgent, next page load is soon enough.
- Actions in lib/actions/patch-notes.ts RETURN {ok,error} rather than throwing (production redacts thrown server-action errors).

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
- Sidebar sections: Auction Manager, **📷 Photography** (added 2026-07-15), Tablet Cataloguing, Lotting Up, Research.
- **📷 Photography (/tools/cataloguing/photography) — added 2026-07-15 at Jordan's request.** Photo uploading is no longer a tab buried in Auction Manager; it is its own section. Sidebar key PHOTOGRAPHY, added to BOTH components/cataloguing-sidebar.tsx and APP_SECTIONS.CATALOGUING in lib/apps.ts. ⚠ **Existing users with CONFIGURED sidebar sections will NOT see it** — getAllowedSections returns the stored appPermissions.CATALOGUING.sidebarItems verbatim when non-empty, so a cataloguer whose sections were ticked before this date has no PHOTOGRAPHY in their list and the section stays hidden (and /photography redirects them). Admins and users with no configured sections see it automatically. Fix per user: tick Photography under Admin → Users & Permissions → Cataloguing → Visible sections. This applies to ANY new sidebar section — the permission model working as designed. Flow: photography/page.tsx (server: auth + section check, loads auctions with per-lot imageUrls for photo progress) → auction-list.tsx (client: a card per sale with a photographed X/Y progress bar, search + type filter, stats strip, collapsed Completed sales, "📷 Start photography") → photography/[id]/page.tsx (server: header + section check) → photography-client.tsx (thin client wrapper — a server page cannot pass onUploaded to a client component) → renders the SHARED auctions/[id]/photo-upload-tab.tsx (left in place, not moved, so that long heavily-reviewed file keeps its history). **The Upload Photos TAB was removed from Auction Manager** (auction-tabs.tsx: Tab type, tabs array entry, render block and import all gone) so there is one obvious place to upload photos — don't re-add it. Match by filename is kept as one of the two modes. **🔧 Barcode debug (photography/debug/, added 2026-07-15):** a single-image diagnostic linked from a "🔧 Barcode debug" button on the Photography header. debug-client.tsx runs the SAME decode pipeline (native BarcodeDetector + zxing) instrumented: a per-pass table (Native / ZXing·Hybrid / ZXing·Global × sizes full/2000/1600/1200/900 × treatments normal/contrast/bw) showing what each decoded + whether Vectis-format; normal/contrast/bw canvas previews; an "Ask AI what it reads" button (POST /api/catalogue/scan-photos, one photo); and the key bit — a CONSISTENCY test running the exact PRODUCTION pipeline (one reused reader, decodeWithState, [2000,1200]×[normal,contrast,bw] Hybrid) 8× and tallying outcomes, flagging "flaky!" if they differ. Built to chase a label (F091093). Debug PROVED: it fails on ALL zxing passes (Hybrid+Global × sizes incl full 4176px × normal/contrast/bw) and consistently (8/8 not-read — so NOT decodeWithState flakiness, that theory disproved). No "Native" rows in the table = BarcodeDetector unavailable on Jordan's device, so only the weaker pure-JS zxing runs, which scans STRAIGHT HORIZONTAL LINES with almost no skew tolerance — a label tilted a few degrees (which a hardware scanner reads fine head-on) has no clean line across the bars. Debug proved ROTATION also doesn't help (126 passes incl full-4176px × all rotations = nothing) — so size/contrast/threshold/skew are ALL red herrings; the pure-JS @zxing/library is just too weak for this photographed barcode. THE FIX: zxing-wasm (zxing-cpp compiled to WASM), added 2026-07-15 — a far stronger engine that does its own localisation/rotation/downscale on the whole file (readBarcodes(file,{tryHarder,tryRotate,tryInvert,tryDownscale}) from zxing-wasm/reader → [{text,format}]). The 1.1MB zxing_reader.wasm is SELF-HOSTED at public/zxing_reader.wasm (not the jsDelivr CDN default), configured via prepareZXingModule locateFile override, loaded lazily. Added to the debug tool first (runs before the JS matrix, shown up top) to confirm it reads F091093 before swapping production. If confirmed, production decodeBarcode should switch to zxing-cpp. Evidence it's fixable: a hardware scanner reads a PRINTOUT of the photo, so the bar pattern is intact in the image. Gated on PHOTOGRAPHY like the rest. **Two tabs on photography/[id]** (photography-client.tsx): 📷 Upload photos · 🔍 View lots (X/Y). **🔍 Lot viewer (lot-viewer.tsx, added 2026-07-15; rebuilt the same day as a FULL LIST):** the first cut was a cramped master-list + detail pane; Jordan wanted "more than just the search — a fully viewable list per auction", so it is now a full-width list showing EVERY lot at once. 4 stat tiles (lots / with photos / still need photos / photos in total), search (barcode, ID, title, key points, vendor, tote), All / With photos / No photos chips, and a Detailed / Compact density toggle. Each row: the **barcode label photo on the left** (amber — the point of the feature; click to zoom, captioned "should read <barcode>"), all the lot's photos inline (first tagged Main), key points + description (clamped, "Show more" expands), plus vendor/tote/category/condition. Lots with no photos get an amber border. Full-screen captioned zoom on any photo. ⚠ **Images go through /api/catalogue/photo-proxy?key=… with loading="lazy", NOT /api/catalogue/signed-url** — the first version signed each key with its own round-trip, fine for one open lot but ~1,900 requests for a 471-lot sale; the proxy streams by key and native lazy loading fetches only what is on screen (also the documented house rule: never fetch a raw R2 key). The auction cards have a **🔍 View lots (N)** button under Start photography linking to ?tab=view; photography-client.tsx reads that search param to open on the viewer (the page is force-dynamic so useSearchParams needs no Suspense boundary). **⚠ CatalogueLot.labelPhotoUrl (TEXT, nullable) — NEEDS Run Migrations.** The barcode label photo used to be read and DISCARDED; it is now kept, but in its OWN column, deliberately NOT in imageUrls — imageUrls feeds the website, BC and the AI description runs and a label photo must never reach any of them (Jordan's explicit choice when asked). Stored in R2 under lot-labels/{auctionId}/{lotId}/, written by the new uploadLotLabelPhoto action (returns {ok,error}, logs a new photo_label action via logLotPhoto — the lot-log union was widened for it). The client uploads it after a group's real photos succeed and IGNORES failures (the photos matter; the label is a bonus). Only lots photographed via smart scan from 2026-07-15 have one — filename-mode and older lots show "No label photo". photography/[id]/page.tsx selects it inside a try/catch that falls back to a select WITHOUT it, so the deploy cannot 500 the page before Run Migrations is clicked (same migration-safe pattern as getAllInstructions). Redesigned upload flow: idle = two explainer cards (Smart scan folder — recommended / Match by filename) + AI model picker; scanning = a 2-step stepper ("1 Reading barcodes" → "2 ✨ AI double-checking every photo") each with its own progress, plus ETA, a live status line and Skip; preview = 4 stat tiles (Lots matched / Photos to save / Not in this sale / Need a look) + tone-coded notices + group cards with thumbnails + a sticky Save bar (nothing saves until Save); uploading = shows the lot currently saving + a live per-lot ✓/⚠ log; results = outcome banner (green all-saved / amber finished-with-failures / red nothing-saved), 4 stat tiles, a "Lot by lot" table, the reasons any photo failed, a "Still to sort out" list (unmatched labels, unreadable labels, pre-barcode photos), then "Upload more photos" + "Back to Photography".
- Per-auction tabs: Manage Lots, Add Lot, Photo Only Cataloguing, Import Lots, AI Upgrade, Review, Statistics (incl. Lots Missing Photos), Lot History, **🔒 Locking Check**, **📋 BC Check**, **📤 Push to BC**, Auction Settings (Upload Photos moved out to the Photography section 2026-07-15)
- **Locking Check tab** (locking-check-tab.tsx): validates every lot has title (not 'Untitled'), description, estimateLow, estimateHigh, and ≥1 photo. Summary cards (total/ready/failing). Filter: Failing only / All lots. Red issue badges per lot. "Fix →" navigates to the lot in Manage Lots tab.
- **BC Check tab** (bc-check-tab.tsx): upload BC Lines export (.xlsx), cross-references by UniqueID then barcode. Flags title mismatches (case-insensitive normalised), estimate low/high mismatches, lots in our system missing from BC, lots in BC not in our system. BC columns used: Internal Barcode, UniqueID, Short Description, Low Estimate, High Estimate.
- **Push to BC tab** (bc-fill-tab.tsx, tab id "bc-fill", added 2026-06-24): copy-paste BC-import builder. Paste the BC import sheet (TSV from Excel, MUST include the header row) → it fills the Hub-owned columns matched by **UniqueID = receiptUniqueId (NOT row position)** → copy the result back over the same top-left cell. Columns filled: Short Description ← title; Low/High Estimate ← real estimateLow/High, falling back to aiEstimateLow/High (flagged); Size Classification ← lot.notes (the parcel size: Small/Medium/Large/Contact/Collection Only); Article Category Code ← category; Article Subcategory Code ← subCategory. Category values are already BC-style codes (e.g. RETRO_TOYS). Matches columns by header NAME (case-insensitive) so "Article Subcategory Code" never collides with "Article Subcategory 2 Code", and a shifted/extra cell can't misalign. Preserves every other cell, same column count/order, so paste-back is cell-for-cell identical. Validation report: UniqueIDs not in Hub, lots missing estimate/size/category, AI-estimate fallbacks, Hub lots absent from the sheet, expected columns missing from the paste. Pure client-side (no API) — page already passes all needed lot fields. Solves the positional copy-paste errors that broke imports when one cell was out of line. Verified against a real BC export (2026-06-24): 75-column sheet, mapped headers at UniqueID=C, Short Description=H, Article Category Code=N, Article Subcategory Code=O, Size Classification=Q, Low Estimate=U, High Estimate=V — matched by name so column letters are informational only.
- Review tab (shared review-tab.tsx, also on tablet): photo (tap for modal; each image has hover "⛶ Fullscreen" → full-screen overlay), key points with ✓/≈/⚠ markers (word-level stem matching), description with per-KP colour highlights. Filters: search, cataloguer, issues dropdown (All lots / ⚠ Needs attention / ≈ Wording to check / Either of the above / ✓ All good), Flagged-only, **AI-flagged only toggle** (filters to lots with aiFlagNote). **⚠ ISSUES ARE SPLIT IN TWO (2026-07-31, Jordan: "almost all of them are just partial word checks")** — the single "⚠ N with issues" button buried the handful of real problems among ~90 wording checks. Now TWO clickable header buttons, each toggling its own filter: **"⚠ N needs attention"** (red) = \`needsAttention()\` — a key point with status **missing**, or no description, or no photos, or a human \`reviewFlag\`; and **"≈ N wording checks"** (amber) = \`wordingOnly()\` — status **partial** or **reworded** only. ⚠ The buckets are **EXCLUSIVE** (a lot with a missing key point never also counts as a wording check) so the two counts plus the all-good lots add up to the total; \`hasIssues()\` is kept as "either" and still backs the "Either of the above" option. Colours deliberately mirror the per-lot chips (missing = red, partial/reworded = amber). THREE DISTINCT things beyond that: issues (above); "Flagged only" = human reviewFlag; "AI-flagged only" = aiFlagNote. The header counts have been CLICKABLE buttons since 2026-06-24 — previously users clicked the flag buttons expecting those lots and got nothing. Error flagging: setLotReviewFlag action. **AI flag note:** CatalogueLot.aiFlagNote (TEXT nullable) — set by pipeline batch when AI spots a potential cataloguer mistake; shown as amber ⚠️ banner with two options: "Edit description to fix…" (inline textarea, saves + clears flag) and **"Ignore (AI is wrong)"** button (calls saveAiFlagNote(id, null) to dismiss without editing). A lot with an active edit textarea is always kept in filtered results regardless of active filters. Key point analysis shared lib: lib/kp-analysis.tsx (analyseKeyPoints, HighlightedDescription, kpColour) — imported by review-tab.tsx and AI Upgrade tab. Save-description error UX (2026-07-01): failures now show INLINE at the Save button (saveErr state) instead of the far-off top banner (cataloguers on a long/tablet list couldn't see it and thought Save "did nothing"). Bigger fix same day: in production Next.js REDACTS a thrown server-action error's message to the generic "Server Components render" string, so a cataloguer editing a BC-LOCKED auction (addedToBC=true → requireNotBCLocked blocks non-admins; admins bypass — hence "works for admin, not cataloguers") saw gibberish. Fixed by making saveLotDescription/setLotReviewFlag/saveAiFlagNote RETURN {ok,error} instead of throwing, and showing res.error. Button shows "Saving…" via useTransition pending. THEN (2026-07-01, per Jordan) those three Review actions were made to BYPASS the BC lock entirely — the Review tab is QA/corrections and cataloguers may fix lots even after the auction is in BC; the lock still applies to the wizard/Manage Lots/updateLot, delete, bulk actions and transfer. Don't re-add requireNotBCLocked to the three Review actions. **⚠⚠ THE KEY POINTS ARE UPSTREAM OF THE DESCRIPTION (2026-08-17, Jordan: "when I fix a description because a key point is wrong it shows up as needing attention").** A cataloguer who types R4328 into the key points and R3428 into the description leaves the lot stuck on "needs attention" for ever, and **editing the description cannot clear it** — the matcher is right, that key point genuinely is not in the description. This is the most important fact about the whole flag/fix flow: **the Key Points stage exists to force every key point back INTO the description**, so correcting only the description while the wrong fact sits in the key points means **the next pipeline run puts the error back**. New actions \`resolveKeyPointsMistake(lotId, auctionId, {keyPoints?, note?})\` / \`clearKeyPointsMistake\` record the checker's verdict on **CatalogueLot.kpFixNote / kpFixedBy / kpFixedAt** (NEEDS Run Migrations). Two outcomes offered in the key-points box on each card: **correct them** (much the better one — every later AI run is measured against the key points) or **"Leave them — just mark it as a mistake"** (records the verdict, changes nothing). \`kpResolved()\` then drops the lot out of BOTH buckets and retires the three warning pills; ⚠ a missing description or missing photos STILL counts, since that verdict was only ever about the key points. The per-line ⚠ stays in the key-points list so you can see *which* key point was wrong. Undo clears the verdict only — it never restores wrong key points. **✨ FIX ALL AI-FLAGGED — preview, then apply (2026-08-17).** Jordan asked for a one-go button for the aiFlagNote lots and proposed the right shape himself ("correct the key points first and then re run them through like its own mini pipeline"); he chose "Preview, then apply" over writing as it goes. \`POST /api/auction-ai/autofix-flag\` now returns **JSON** — {description, keyPoints, descChanged, where, note} — instead of bare text: it works out **where the flagged error actually is** and corrects the key points **only when the wrong fact is in them**, echoing them back untouched otherwise (keyPoints is null unless it really differs, so a stray space can never rewrite the cataloguer's notes). The modal generates EVERY correction first (sequential, ~400ms apart, rate limits waited out with a visible countdown + Stop button, failures listed with "Try the N that failed again" — never silently dropped), then lists them: the AI's flag, the changed key-point lines old → new, and a per-row expander for the description before/after; rows are ticked by default and untickable. \`applyFlagFixes(auctionId, fixes)\` writes only the ticked rows under one batchId and stamps kpFix* on any lot whose key points it corrected — otherwise the lot lands straight back in "needs attention" with the old key point absent from the new description. ⚠ Nothing is written until Save: a person reading each correction is what makes rewriting the cataloguer's own notes acceptable here, given the same day's rule that the AI must FLAG a disputed product code rather than overwrite it. Batch is deliberately NOT re-run — it regenerates the whole description from the photos, costs far more, and throws away good wording that has nothing to do with the flag.

⚠ 2026-08-19 — "THE AI'S ANSWER COULD NOT BE READ" ON ✨ FIX ALL AI-FLAGGED. The route returns a JSON object holding TWO WHOLE DOCUMENTS (the corrected description AND the corrected key points) and capped maxOutputTokens at 2000 — ample for the short descriptions of 2026-08-17 when it was written, not ample now the house style produces long multi-bullet descriptions. Worse, lib/ai-provider.ts treats a MAX_TOKENS finish as ACCEPTABLE (correctly, per RULES.md) and returns the text anyway, so a reply cut off mid-object arrives looking perfectly normal and only fails at JSON.parse. Three fixes: (1) maxOutputTokens 2000 → 8192 — a cap is not a spend, only tokens actually generated are billed, so there was never a reason to run it this tight; (2) SALVAGE WITH extractJsonField, which the Key Points and Double Check routes already did and this one was the odd one out — "description" is the FIRST field in the requested shape so it usually survives a truncated tail, and ⚠ key points are only ever taken from a COMPLETE value (extractJsonField needs a closing quote, so a reply cut off inside the key points yields null and the cataloguer's notes are left alone, which matters because this route may rewrite them); (3) the message no longer lies — "try again" is useless advice for an over-long lot, which truncates every time, so a reply that never closed its JSON now says it was cut off and points at the per-lot Auto-fix. ⚠ The CLIENT was already right: runBulkFix marks the lot failed and offers "Try the N that failed again", and only auto-retries rate limits — do NOT add a retry for this error, retrying a truncation reproduces it. ⚠ If the new wording ever appears, the lot really is too long for one pass and the answer is not a bigger cap — it is that the route is being asked to echo back a whole catalogue entry to change one product code; a future fix would return only the changed LINES.
- **Upload Photos tab — Smart scan rework (2026-07-15, photo-upload-tab.tsx):** the "Smart scan folder" mode reads Vectis barcodes (F066001 / R000016-413 formats only — retail EANs rejected) from a folder of photos and groups them sequentially: a barcode photo STARTS a lot group (the label photo itself is discarded, never uploaded), following photos join it until the next barcode. Reworked in one pass: (1) scanning is now PARALLEL, 3 images at once via an order-preserving pool (mapPool — results land at their file's index so grouping order is untouched); (2) photos before the first barcode are no longer silently dropped — collected into preGroup and shown in the preview as a warned "won't be uploaded" bucket with thumbnails; (3) files the browser can't decode (HEIC from iPhones on Windows/Android) are counted as "unreadable" with an orange warning that labels inside them can't be detected (they still group + upload fine as item photos — Thumb component falls back to a 🖼️ tile); (4) the preview is now thumbnail CARDS per group (object URLs cached in a ref Map keyed by File, created in makeThumbs, revoked on reset/unmount) instead of a filename text table, so misfiled photos are visible before upload; (5) groups with photos.length >= max(6, 2×median) get an amber "unusually many photos" flag — the signature of a label that failed to scan merging two lots (scan mode only; filename mode grouping is deterministic); (6) uploadLotPhoto (lib/actions/catalogue.ts) now RETURNS { ok, imageUrls | error } instead of throwing (production redacts thrown server-action messages — same fix pattern as the Review tab actions); all four callers updated (photo-upload-tab per-photo failure list, auction-tabs / tablet-tabs / lot-photos-tab alert the real reason, e.g. the BC lock). Done screen counts uploaded = attempts − failures. No migration.
- **Photo Only Cataloguing tab** (lot-photos-tab.tsx): per-lot panel shows photos with teal border + "Main" label on index 0, gray "Photo N" labels on others, original filename underneath each thumbnail. "↕ Reverse order" button (2+ photos) calls reorderLotPhotos action. On filename-based import, photos within each lot group are **reversed** (highest-numbered file → main). R2 key format: 'lot-photos/[auctionId]/[lotId]/[Date.now()]-[safeName]' (preserves original filename; old format had no filename). Lot wizard also shows filenames under photo thumbnails.
- **Lot Wizard** (lot-wizard-tab.tsx): 8 sequential steps — 1 Vendor & Tote, 2 Barcode, 3 Key Points, 4 Categories, 5 Estimate, 6 Condition, 7 Parcel Size, 8 Photos. Step dots are NOT clickable (advance via Next/Back only). Required fields are enforced in validateStep(s) which blocks Next (error shown above the nav): step 1 vendor+tote+receipt (receipt made required 2026-06-25), step 2 barcode, step 5 estimate low+high, **step 7 parcel size (made required 2026-06-24 — needed for the BC Size Classification column; parcel stored in CatalogueLot.notes)**. Required labels show a red *. Field checks are only a soft 7-character length warning (bypassable) + maxLength 7 — no strict pattern check. Remember-last (2026-06-25): Tote/Vendor/Receipt persist per USER ACCOUNT (User.lastTote/lastVendor/lastReceipt columns — NEEDS Run Migrations) so they follow a cataloguer across shared iPads and survive closing the app; wizard pre-fills blank fields on open via getLastLotFields() and saves via saveLastLotFields() after each createLot (barcode still uses localStorage). **Step-1 rework (2026-07-07):** removed the Tote/Vendor/Receipt **Pin buttons** (category Main/Sub pin kept). **The tote is now the source of truth** — typing/selecting a tote ALWAYS overwrites vendor+receipt (the old "only if blank" guards in selectTote/lookupVendorFromBC caused a changed tote to keep the previous vendor/receipt = the mismatch bug), and editing the tote text clears the derived vendor/receipt so a not-in-BC tote can't keep stale values. Step-1 nav button is **"Start cataloguing →"** (startCataloguing → validate → 7-char gate → commitStart), which sets 'locked' {tote,vendor,receipt,vendorName} and advances; the values carry across every lot (no pins). Changing mid-batch: the step-2 "Change Tote / Vendor" chip runs **changeVendor()** (wipes tote/vendor/receipt for a clean re-entry, keeps 'locked'), and pressing Start with values differing from 'locked' opens a **confirmation modal** ("change vendor to X · tote · receipt", shows current). Receipt→vendor reverse lookup only runs when NO tote is set (tote wins). goBack() now clears barcodeWarning/step1LengthWarning (else the Start button stayed disabled back on step 1). Client-only, no migration. **Spell flagging on Key Points / Description (2026-07-07):** step 3 lists unrecognised words underneath the textarea ("⚠ Possible spelling mistakes: …") — FLAG ONLY, no auto-fix/suggestions (Jordan's choice). Fully client-side + offline via lib/spellcheck.ts: lazy-fetches a 274k-word British/English list from public/dict/en-words.txt (built once from the an-array-of-english-words package, then committed; ~2.7MB, gzips to ~800KB, loaded only when step 3 is first reached), builds a Set, debounced 400ms. Deliberately NOT flagged: brand names (reuses the wizard's BRANDS_LIST, split into tokens), all-caps codes (LNER/GWR/BR), any token with a digit (catalogue numbers, scales like R2290 / 1:76), tokens under 3 chars, and a small VECTIS_TERMS allowlist (diecast/playworn/approx/vgc/…). Hyphenated words check each part. Fails open (network error → no flags). No AI, no network round-trip per lot, no migration. **Separate box/packaging condition (2026-06-24, extended to all editors 2026-06-25):** checkbox under the main condition reveals a Wording picker ("Box is" / "Packaging is" / Custom free-text) plus the same grade selector with its own optional "to" range. Saved as a separate sentence on the condition — e.g. "Near Mint to Excellent. Box is Good to Good Plus." Only added when the box is ticked AND a prefix AND grade are set. Now available in all three lot editors via shared lib/condition.ts (parseCondition/buildCondition/CONDITION_GRADES): the Lot Wizard (buttons), the desktop auction-manager editor (buttons, autosaves) and the tablet editor (dropdowns). Wizard only builds; desktop + tablet also parse the stored string back into the fields. Edit lib/condition.ts to change the format. Wording presets are DB-managed (2026-06-25): the "Box is"/"Packaging is" picker is driven by the ConditionWording table, seeded with Box is / Packaging is / Carded Back is / Blister Card is (format "<wording> is" so it reads "Carded Back is Mint"). Read via useConditionWordings() hook + /api/catalogue/condition-wordings; managed (add/rename/reorder/delete) at Admin → Condition Wording (/admin/condition-wording, admin-only). Each editor also keeps a per-lot Custom free-text wording. NEEDS Run Migrations on staging (ConditionWording table).
- Auctions list page: split into Active and Completed tables. Complete column is an interactive toggle (CompleteToggle → toggleAuctionComplete). **Filterable** (2026-06-26) via a shared filter bar (search code/name + Type dropdown + status dropdown) in the client component auctions-tables.tsx; both tables filter together and show a (count). Each auction Type shows a **fun emoji** (🚂 trains, 🚗 diecast, 🎬 TV/film, 🧸 bears, etc.) on desktop + tablet lists + the New Auction dropdown — single source of truth in lib/auction-types.ts (auctionTypeEmoji/auctionTypeLabel/AUCTION_TYPES).
- Manage Lots table: Added By (createdByName, sortable), **Date Added** (createdAt, sortable — sorts on the real date, not the formatted string; also in the Excel export), **KP column** (✓/— with Has KP / No KP filter), **AI column** (🚫 excluded / ✨ upgraded), **AI Excluded filter**.
- Manage Lots mass actions: mark/unmark added to BC, generate titles, transfer, delete lots, 📷🗑 Delete photos (bulkClearLotPhotos), **🚫 Exclude/Unexclude from AI** (bulkSetLotsAiExcluded)
- Manage Lots FILTERS: every column has one. Added By is a dropdown of the people who actually added a lot to THAT sale (not free text — it cannot be mistyped); Date Added is a native date input. ⚠ The day comparison uses LOCAL date parts, never toISOString() — UTC would file anything catalogued after 01:00 BST under the previous day, and disagree with the column right next to it. Both persist with the rest of the filters in sessionStorage.
- The bulk action bar is now ALWAYS VISIBLE (2026-08-14). It used to appear only once lots were ticked, which is exactly why Jordan asked for a mass AI-exclude that had existed for months — you cannot look for a button you have never seen. Greyed with "Tick lots to use these" when the selection is empty. ⚠ EVERY button in it is disabled when nothing is ticked: several of those handlers fall back to "every lot in this auction" on an empty selection, which was harmless while the bar only existed during a selection and would be catastrophic on a permanently-visible "Delete lots".
- ⚠ The Registered Bidders banner was REMOVED from the sale page (2026-08-14, Jordan's call) — it sat above everything and pushed the whole page down. registered-bidders-panel.tsx and the bidderRegistrations include still exist; only this page stopped rendering it.
- **Tablet lots list** (tablet-tabs.tsx → TabletManageLots, /tools/cataloguing/tablet/auctions/[id]): card list with a search box (barcode/title/vendor/tote), Sort chips (Lot No. / Newest / Oldest) and — added 2026-07-14 — a **Cataloguer filter** dropdown (built from the distinct CatalogueLot.createdByName values on that auction, with an ✕ to clear). It only renders when 2+ people have catalogued in the auction, combines with the search + sort, and the "N of M" count shows whenever either filter is active. Client-side only — no query/API change. ⚠ **The search/sort/cataloguer state is OWNED BY THE PARENT (TabletTabs), not by TabletManageLots** (fixed 2026-07-16): opening a lot swaps the list out for TabletLotEdit, which UNMOUNTS TabletManageLots — so local filter state was wiped every time a cataloguer came back from a lot, and they had to re-filter each time. Don't move those three useStates back into TabletManageLots. (Same reason the Add Lot tab is hidden-not-unmounted.)
- Lots have addedToBC boolean, aiExcluded boolean, aliases for Unique ID matcher
- bcLocked = auction.addedToBC && userRole !== "ADMIN" — gates mutations
- Export/Import xlsx on auctions list page
- Lotting Up (/tools/cataloguing/lotting-up): AI photo → proposed lot groups with bounding boxes
- Research (/tools/cataloguing/research): Quick-launch Google/eBay/WorthPoint/Catawiki/Vectis/Wikipedia + invisible research timer
- Tablet Mode (/tools/cataloguing/tablet): Touch-optimised iPad interface. Lot cards show key points at bottom and creator name (👤) in metadata row.

### Auction AI (/tools/auction-ai) — 14 tabs
Sidebar organised into groups: Chat / Run / History / Tools / Reference.
Chat Window, Batch Run, Key Points Check, Double Check, Auto Pipeline, AI Upgrade (Run group); Saved Runs, KP Check Runs (History group); Description Copier (shows a "Have you added conditions to the description?" reminder modal every time the tab is opened — added 2026-06-29 via an 'active' prop on CopierTab + a useEffect; dismiss with "Got it"), Barcode Sorter (Tools group); Instructions, Macro Downloader, BC Import Check (Reference group). (The old "Models" tab was removed 2026-06-29 — model enable/disable + tester merged into Admin → AI Models.)

Key Points Check: validates descriptions against key points, returns verdict/contradictions/unsupported claims/revised description. Stored in KPCheckRun/KPCheckLot tables. Partial match rule: a key point is only satisfied if its exact meaning is explicitly present — partial word matches do not count. JSON parsing hardened 2026-06-25 via shared lib/model-json.ts (parseModelJson + extractJsonField), used by Key Points, Double Check AND Batch routes. Gemini sometimes returns invalid JSON (commonly an invalid backslash-apostrophe escape — e.g. a foot/inch measurement like 61'6"). Old per-route catch blocks dumped raw JSON into a UI field: KP put the whole blob into the lot description; Double Check showed {"contradictions":"",...} in the contradictions box and lost the revised cleanup. Now both parse via the shared helper (repairs the escape, retries), salvage the needed field via regex on total failure, and never show raw JSON.
Double Check: second-pass AI validation. Uses React 18 batching fix pattern.
Auto Pipeline: chains Batch → Key Points → Double Check (TEST ORDER from 2026-06-05). Batch & KP AUTO-APPLY; Double Check is the final MANUAL Review & Apply gate. Content blocks = skipped, errors retry infinitely. Google Search toggle (off by default). Stored in PipelineRun/PipelineLot tables. Per-lot 🔍 AI log button shows exact prompt + raw response per stage. Results table (2026-06-25): "— Skipped" cells show the per-stage reason (batchSkipReason/dcSkipReason/kpSkipReason): "no photos", "no description", "no key points", and for content blocks the SPECIFIC Gemini reason e.g. "content blocked (RECITATION)" / "(SAFETY)" (withRetry stashes the BLOCKED reason in lastBlockRef; blockReasonLabel() formats it). Blocks hit KP/DC but not Batch because the stages send different requests — Batch sends photos, KP/DC send the finished TEXT back; model-railway lots (long catalogue-number lists) commonly trip RECITATION when echoed. Each row also has a ↻ Re-run button (rerunLot) that resets just that lot and re-runs Batch → Key Points → Double Check for it only. Disabled during a full run. "⚠ Problems only" toggle (2026-06-25) in the Results header filters the table to problem lots: any stage skipped, OR Double Check corrected (dcStatus issues), OR Key Points pending, OR a cataloguer flag. Shows the count; disabled when none. Batch prompt preserves exact wording of condition/completeness key points. Google Search grounding nudges verification of catalogue/set numbers. Cataloguer mistake flag: AI appends FLAG: line → saved to CatalogueLot.aiFlagNote (TEXT nullable, cleared on description edit). Stage card "not processed" shows per-reason breakdown (no key points / batch failed / no description). **Re-check Cataloguer Flags button** (below stage cards): text-only AI scan on all lots with descriptions + key points — no images, no full re-run — saves results to aiFlagNote. Route: /api/auction-ai/recheck-flags. **✨ Auto-fix button** (2026-06-29, Review tab flag banner, beside Edit/Ignore): /api/auction-ai/autofix-flag rewrites the description applying ONLY the flagged fix (keeps format, British English, no condition, no invented facts) and drops it into the edit box for review — user clicks Save (clears the flag); review-first by design, not auto-saved. **Google Search grounding always on** in recheck-flags route (verifies set/catalogue numbers before flagging). Prompt + batch route both have CRITICAL rule: never flag a set/catalogue number solely because it is absent from training data (training cutoff issue). Optional final AI Upgrade step (purple panel when stage=complete). Models tab: lists all Gemini models, enable/disable toggle (DisabledModel table). NEEDS run-migrations: aiFlagNote, aiExcluded, DisabledModel, PipelineLot.batchDesc columns.

BC Import Check (bcimport tab, Reference group, added 2026-06-26): client-side only, no DB/API. Fixes the problem where the "add to BC" hotkey macro breaks or errors part-way through a batch. Upload two files: the hotkey sheet (the macro to-do list: ToteNumber, LotCount, Barcodes where Barcodes is pipe-separated F-numbers, e.g. bc_import.csv from the Macro Downloader) and the BC export (the BC Lines xlsx of what actually made it in — columns Internal Barcode, Errors, UniqueID, Tote No.). It matches by barcode, drops the lots already in BC, and gives back a fresh hotkey-format sheet (recomputed counts, finished totes removed) with only the lots still to do — feed that back to the macro. Lots already in BC that have a non-zero Errors value are flagged separately and NOT added to the re-run sheet (Jordan fixes those in BC then re-exports and re-checks). Two parsing gotchas handled: Errors/Warnings are numeric counts where 0 means no error (do not treat "0" as an error); and CSV is read with the field separator forced to comma, because XLSX.read otherwise auto-detects the pipe-heavy Barcodes column as the delimiter. Validated against real files (471 to-do, 293 in BC, 178 remaining). File: app/(app)/tools/auction-ai/bc-import-check-tab.tsx.

Deploy/update banner (components/deploy-banner.tsx) polls /api/version every 30s; shows "app updated" warning when token changes. Version token MUST be RAILWAY_GIT_COMMIT_SHA (stable across replicas + restarts) — NOT Date.now() at process start (that fired false warnings on every OOM/crash/scaling/health-check restart and differed between replicas). The deploy banner is mounted only in the cataloguing shell, not app-wide.

**Also use /api/version to know when a deploy has actually landed — never guess, and never ask Jordan to tell you.** It returns the exact commit Railway is running, so poll it and compare against \`git rev-parse HEAD\`; when they match, the code is live: \`curl -s https://vectis-staging.up.railway.app/api/version\`. ⚠ A **502 "Application failed to respond" right after a push is NORMAL** — Railway briefly drops the service while it restarts; poll until it returns rather than diagnosing a fault. (Learned 2026-07-16 after wasting minutes watching Next chunk hashes and blind-sleeping instead of asking the app.)
Manual announcement banner (added 2026-06-25): app-wide custom banner (components/announcement-banner.tsx) mounted in app/(app)/layout.tsx. Admins set a message at Admin → Announcements (/admin/announcements) — type text, pick a style (info/warning/success), Show to everyone or Turn off. Banner polls /api/announcement every 60s, shows when active, dismissible per-user (re-shows when the message is edited). Singleton Announcement model (id="current"). Constants in lib/announcement-constants.ts, read helper in lib/announcements-db.ts, mutation in lib/actions/announcements.ts (split because a "use server" file can only export async functions). NEEDS Run Migrations (Announcement table).

Pending-migrations banner (added 2026-07-15, components/migration-banner.tsx, mounted in app/(app)/layout.tsx, ADMINS ONLY): amber app-wide banner — "This update needs a database change before its new features will work" + a "Run it now" button that POSTs /api/admin/run-migrations and hides itself on success (errors stay on the banner). Replaces Claude telling Jordan to click Run Migrations — he asked (2026-07-15) for the APP to tell him instead, so do NOT mention Run Migrations in chat any more; just add the SQL and let the banner do it. How it knows: the run-migrations route sha256-hashes its own MIGRATIONS array (MIGRATIONS_HASH) and a clean POST (errors.length === 0 only — a failed run must leave the banner up) upserts it into the single-row MigrationState table (id="current", hash, ranBy, ranAt). The new GET on the same route returns { pending } = no row OR hash differs; a missing MigrationState table also counts as pending, which self-heals the chicken/egg since the CREATE TABLE is itself in the array. GET returns pending:false for non-admins and the layout only mounts the banner for role ADMIN. Adding/editing/removing ANY statement in the array changes the hash, so the banner comes back automatically on the next deploy — nothing else to remember. NEEDS Run Migrations once by hand on each environment (MigrationState table) — after that it announces itself.

Dark-mode form inputs: app/globals.css has a zero-specificity :where(.dark) :where(input,textarea,select) rule giving form controls a default dark bg + light text (fixes "can't see what I type in dark mode" app-wide). Inputs with their own dark:bg/text utilities still win. Don't remove it.
  - Batch stage applies the generated description straight to the catalogue (was a bug: only saved to pipeline DB). The AI estimate (aiEstimateLow/aiEstimateHigh — a SEPARATE field that never touches the real estimate) is written via applyAiEstimateOne and is ALWAYS saved as soon as it's generated, regardless of the ⚡ Auto-apply / 👁 Review-all toggle — the toggle only controls the description. (Fixed 2026-06-24: in Review-all mode the AI estimate was silently dropped because its only write was gated behind auto-apply and the manual Review & Apply gate writes description only.)
  - ⚠ 👁 Review-all toggle now holds ALL stages (FIXED 2026-07-22). Previously only the Batch stage was gated on the auto-apply toggle; the Key Points stage called applyAiDescriptionOne UNCONDITIONALLY ("auto-apply so DC sees the inserted points"), so in Review-all mode ~9/10 lots were still written to the catalogue and only the further-corrected ones appeared in Review & Apply (symptom: "ran 10, only 5 to apply"). Double Check reads the in-memory currentDesc, NOT the catalogue, so KP never needed to apply for DC to see the inserted points. Fix: gate the KP apply on autoApply (mirrors Batch) and set appliedDesc only when actually applied; also stop the Batch stage setting appliedDesc=desc in review mode (it hid un-applied lots). Rule: appliedDesc must only change when something actually writes to the catalogue. Auto-apply mode is byte-identical to before.
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

Instructions — SINGLE SOURCE OF TRUTH (rebuilt 2026-07-01): the aiPreset DB table is the ONLY home for every instruction. Viewed/edited on the Instructions tab (full CRUD, always saved to DB — nothing session-only). Every run resolves its instruction from the DB by key server-side via lib/ai-instructions.ts (resolveInstruction/getAllInstructions) — Batch/Chat/Chat-grounded post a presetKey, never instruction text, so a stale open tab can't run old wording. lib/auction-ai-presets.ts (PRESETS) is now STARTER DEFAULTS ONLY, imported solely by lib/ai-instructions.ts to seed a brand-new EMPTY db once; editing it does nothing to a seeded env. Removed the old code-vs-DB merge, the "Custom (paste my own)" box, and the inline session-only "✎ Edit" modal. Delete is permanent (auto-seed only when the table is totally empty). Export/Import (added 2026-07-01): the Instructions page has ⬇ Export all (downloads a JSON of every instruction) and ⬆ Import (upload → tick which to apply → upsert; New/Overwrite/No-change tags; never deletes). Bulk route POST /api/auction-ai/presets. Purpose: sync instructions from staging to production, which are SEPARATE databases so edits don't cross over automatically. Favourites (added 2026-07-01, NEEDS Run Migrations): AiPreset.favourite Boolean — ★ button pins instructions to the top of the Instructions list (and the run-tab dropdowns). Toggle via PATCH /api/auction-ai/presets; getAllInstructions returns favourites-first; GET ?full=1 gives the list with favourite flags (Instructions tab), default GET still returns the {key:text} map (run tabs). Export/Import is v2 (carries a favourites array so they sync). Reads are migration-safe so a deploy before Run Migrations can't break the AI tools. This fixed the long-standing drift where merely OPENING the Instructions page once silently froze the then-current text into the DB (that's how the 25-June "remove condition from Model Railway" code fix never reached the live app) — NEVER blame the user for instruction drift. Starter set: Vinyl, TV/Film, Modern Diecast, Comics, Model Railway (strict+free), Teddy Bears, General Toys, Military Figures, Matchbox.

Categories + drag layout (2026-07-22, NEEDS Run Migrations): the Instructions list is organised under user-created headers. AiPreset.category (null = Uncategorised) + AiPreset.sortOrder + new AiPresetCategory table (name PK, sortOrder — empty headers persist). UI: "📁 + Add category" button; collapsible headers (localStorage ai_instr_collapsed); hover ✎ rename / ✕ remove (remove moves items to Uncategorised, deletes nothing); drag an instruction (⠿ handle) onto a header (append) or another row (insert above, adopts that row's category); drag headers onto each other to reorder. Favourites stay lifted on top and aren't draggable (a favourite keeps its stored category; unstar returns it there). Persistence is DECLARATIVE: after any change the client normalises and POSTs the whole arrangement to /api/auction-ai/preset-layout {categoryOrder, items}; the server replaces AiPresetCategory to match. GET ?layout=1 returns {instructions, categories}; getAllInstructions orders by category so run-tab dropdowns cluster the same way. Export bumped to v3 with a layout block; import applies layout only to imported keys, appends unknown categories after existing ones, never deletes categories, and degrades gracefully pre-migration (text still lands).

Key points are AUTHORITATIVE (hardened 2026-07-01): the batch route's keyPoints prompt now bans overriding a stated class/model type/catalogue number/running number/livery with a visual or training-data guess — the cataloguer had the item in hand; a strongly-suspected error is KEPT and raised on a FLAG line, never silently changed. Fixed a real bug (key point "Loadhaul class 56" came out "Class 60"). The standalone Batch Run now ALSO sends key points (was photos-only): with an auction code entered it fetches /api/auction-ai/catalogue-lots and maps barcode+receiptUniqueId→keyPoints, appending lot_{label}_context per lot — so Batch and Pipeline both honour cataloguer facts. New self-classifying Trains "Free" instruction (SINGLE/GROUP/BULK/MIXED styles, no condition, no invented numbers/counts, books=title-only) also carries a key-points-authority clause.

### BC Marketing (/tools/bc-marketing) — 9 tabs
Content Generator (16 types), Paste & Generate, Insights, Saved Drafts (DRAFT/APPROVED/PUBLISHED), Hashtag Bank, Web Descriptions, Social Auto Posts, Social Media Images, Email Lists. BC codes (F025, DM0126 etc.) NEVER in AI output.
Email Lists tab: pulls buyer emails from BC AttendenceRegister by auction name keyword + optional date range. Deduplicates by email, collects all sale codes per buyer. API: /api/bc/email-lists. CSV export: Name, Email, Sale Codes. Default: All time.

### BC Warehouse (/tools/bc-warehouse) — 8 tabs
Location Heatmap, Sale Checklist, Search by Location, Location History (DO NOT redesign), Tote Data, Collections Due, Unsold Items, Data Sync, DB Explorer.
**Tote Data "By Category" fix (2026-07-07):** the category chart was permanently empty ("CATEGORIES 0") because it INNER-JOINed active totes to warehouse items on tote number — but BC's item feeds don't populate the item-level tote field (only 2 of ~202k items have a toteNo). Now joins on receiptNo instead (populated on every active tote and its items), which gives a real breakdown; the chart notes that a receipt can span several categories so a tote may appear under more than one (per-category tote counts are an approximation), and each bar now shows the item count in brackets. By Location + Raw Data were never affected (no item join). Report route: /api/warehouse/tote/report. No schema change/migration.
Scheduled sync: /api/cron/bc-warehouse (server interval scheduler, CRON_SECRET) loops receipt-lines, totes-active AND totes-all to completion (totes-active loop added 2026-07-27, totes-all added 2026-08-06 — both thread nextLink; before that totes-active did one batch and never advanced), then auction-lines/changelog/totes/auction-names — but INCREMENTAL only, so newly-added columns need a one-time full re-sync (Data Sync → amber Full re-sync button) to backfill historical rows; the cron then maintains them. Data Sync shows a "Shipping column coverage" line (total items · with collection · with size, from /api/warehouse/sync/status) to confirm a full re-sync populated the Shipping report columns.

### BC Reports (/tools/bc-reports)
Cataloguing report (barcode/uniqueid/compare modes), Packing report, **Shipping report**, **Warehouse Report** (Warehouse tab).
**Warehouse Report** (Warehouse tab): live BC pull of Receipt_Totes_Excel (via /api/bc/warehouse, current user's BC token) — totes By Category / By Cataloguer / Raw Data, with a Refresh Snapshot button. Fields used: EVA_TOT_ArticleCategory, EVA_TOT_AssignToCataloguer (code → SALESPERSON_NAMES), EVA_TOT_Catalogued, EVA_TOT_No/Description. 2026-07-07: the WHOLE report now excludes catalogued totes (EVA_TOT_Catalogued === true) — previously only By Cataloguer did, while By Category / Total Totes / Raw counted everything. Total-totes card relabelled "Totes to catalogue" and shows an "N catalogued excluded" subtitle (meta.cataloguedExcluded). Also 2026-07-07: a **date-range filter** (shared DateRange component + presets) on the tote's creation date — BC field **SystemCreatedAt** on Receipt_Totes_Excel (record-created = when the tote was created/arrived). from/to (YYYY-MM-DD, inclusive) are passed to /api/bc/warehouse and filtered in JS (fetch-all then window; tote set is small, avoids OData date-syntax risk); totes with no/blank SystemCreatedAt (incl. BC's 0001-01-01 sentinel) are hidden while a range is set and surfaced as meta.undated ("N totes have no creation date"). Raw Data's redundant all-"No" Catalogued column replaced with a Created (date) column. Route now has the standard try/catch wrapper (it was missing). Also a **"Hide bench & blank-location totes" checkbox** (excludeBench param) — drops totes whose EVA_TOT_ToteLocation is blank OR contains "BENCH" (case-insensitive; bench totes are BENCH10/BENCH11… = at a cataloguing bench, not shelved); count hidden shown as meta.locationExcluded, and a Location column added to Raw Data. (Verified on prod 2026-07-07: of 2,073 active totes, 58 blank + 626 bench + 1,389 real shelf locations.) (Live BC only — no DB cache, no migration.)
**Shipping report** (Shipping tab, 2026-06-26): parcels by country / region (UK / Europe / Rest of World) / city, By Month trend (parcels + est. revenue per month), Items-by-location breakdown (STANDALONE count of WarehouseItem by location in the period — restricted to items with a collectionNo (COL number), filtered by auctionDate in the period (NOT bcModifiedAt — that wrongly pulled in old lots touched recently); buckets Shipped / Collected / SANDOWN / Not scanned-unknown (everything else, EXCLUDING the last month since recent collections may be undispatched); Not-scanned has a drill-in listing its actual location values, and excludes known holding locations ARCHIVE + QUERY (EXCLUDED_LOCS); counts + % only, NOT linked to the shipment join; plus estimated revenue reduction from collections (meta.collectedRefund — Collected items priced at UK rates grouped by collection = hypothetical lost/refund revenue; collected sales raise only a COL docket, NOT a shipment request, so they are NOT in the shipping revenue total — no double-charge; Jordan confirmed 2026-06-29 the headline counts ONLY actual shipments, so collectedRefund is NOT subtracted — it's displayed together with the headline revenue as a "we'd have earned £X more if collected items had posted" line); plus a "Sizes: shipped vs collected" table (sizeByDisposition, 2026-06-29) — per-size All/Shipped/Collected + % collected from the warehouse-location data (consistent population, so totals differ from the revenue Items-by-size table), to check if bigger items skew toward in-person collection); final review 2026-06-29 fixed 6 presentation issues (no arithmetic bugs): PDF country-grid empty cells now "-" not "·" (safeAscii strips non-ASCII to blank); the notScannedExcludesLastMonth caveat is now actually rendered (UI+PDF); PDF "Where items are now" subtitle names all 4 rows; PDF region table gained the Items column; collectedRefund note gap; By Country/By City "Shipments"→"Parcels". Lesson: keep PDF and on-screen report in sync), Items-by-size breakdown ("Items by size" — real sizes only; the un-docketed estimate is shown as a separate "+ about N more items" line, NOT a fake size row (Jordan 2026-06-29); every section has a plain-English explainer; PDF free text must use the wrapLines/drawWrapped helpers since pdf-lib drawText doesn't wrap, and needs a ~8pt gap before any note drawn right after a table or it overlaps the last row), estimated shipping revenue, country × size grid, World/UK maps, Download PDF. Joins ShipmentRequestAPI (destination country = EVA_CountryRegion, parcel docket EVA_DocumentNo, filter EVA_Status ≠ Cancelled) to receipt-line sizes (EVA_SHIP_EVA_SizeClassification) via the collection number — sizes read from local WarehouseItem.collectionNo/sizeClassification, so a one-time full receipt-lines resync is needed to backfill (amber banner until then). Revenue (ex VAT) = per parcel: one first-item charge (dearest lot) + every other lot at its size's additional rate, per Vectis UK/EU-zone pricing (parcelLotCharges in lib/shipping-rates.ts, static snapshot of Shipping Rates.xlsx); Rest of World = quote-only → £0; no hammer price. Logic: lib/shipping-analytics.ts; PDF: /api/bc/shipping/pdf. Sizes/revenue depend on a COMPLETE receipt-lines resync (collectionNo/sizeClassification nullable, no backfill) — a partial resync silently undercounts items/revenue (parcels stay correct); report warns when >3% of parcels lack local lot data, counts blank-size shipped lots as Unspecified (£0), and fetches shipments via skiptoken (not $skip). Note: BC's 69,880 lots (per-lot, auction date) is NOT comparable to items-shipped (shipped lots, shipment date; ~5 lots/parcel, ~60% ship). Unlinked parcels (2026-06-29): some shipments have EVA_DocumentNo="DISPATCH" (no COL link, big share pre-Sep-2025) so their lots can't be joined; report counts them as "unlinked" (per-month "No docket" column + orange banner), parcel still counted, and rough-ESTIMATES their items/£ at the average per linked parcel in the same region (UK/Europe/RoW) — folded into headline/By Month/By Region as a labelled rough total; By Size/Country×Size stay actual-only. Caused the "Jul/Aug 2025 items too low" symptom. Bug audit (2026-06-29, adversarial workflow — 9 real bugs fixed): Not-scanned window made day-overflow-safe + no longer inverts for ranges ≤1 month (sub-month windows count the full window via meta.notScannedExcludesLastMonth); By City keyed by country|city (no more same-name merge / UK-map mis-plot); date presets format from LOCAL fields (fmt()) not toISOString() (fixes BST off-by-one-day); UK + IM added to SHIPPING_RATES (were £0 — UK=GB; IM ASSUMED=Channel-Islands tier, confirm with Jordan); estimated items allocated to By Region/By Month via largest-remainder (allocateRounded) so columns sum exactly to the headline; region estimate falls back to all-region average when a region has 0 linked collections (RoW stays £0); Not-scanned drill-in adds an "(N other locations)" remainder row so it sums; By Month attribution pinned to a collection's earliest shipment date (deterministic); PDF safeAscii NBSP-normalisation fixed. PDF review follow-up (2026-06-29): BC emits the literal "UK" code too, so "United Kingdom" showed twice (GB + UK) — fixed by normalising country codes (COUNTRY_ALIASES {UK:GB} in lib/country-names.ts + normCountry() in shipping-analytics.ts); expanded COUNTRY_NAMES (was missing GG/JE/IM/GI/NI + Europe + common RoW → showed bare codes); fixed a stale PDF footnote ("see No docket" → "Estimated (no docket)" row). EUROPE_CODES not in the source sheet (GI/ME/AD/MC/LI/RS/SM/VA/AL/AX/BA/FO/MD/MK) were £0 — Jordan (2026-06-29) chose to price them at the standard western-EU tier (£34.95/49.95/64.95), now in SHIPPING_RATES.
Price Calculator sub-tab (2026-07-06, after Items by Size): shows the current shipping matrix as its 3 real price bands (UK; Europe West + Channel Islands; Europe East & rest — the ~50 countries collapse to these) and lets Jordan add £ to every first-item price and every extra-item price (defaults +£1.00 / +£0.50, both editable) to see the extra revenue on the parcels actually shipped in the selected date range. Live client-side calc. Driven by data.rateScenario from lib/shipping-analytics.ts — per band×size counts of items charged at the first-item vs extra-item rate (rate greater than 0 only) plus that band's current prices; extra = firstItems×upliftFirst + extraItems×upliftExtra, EXACT for a uniform uplift (Σ currentRevenue reconciles to estRevenueTotal). Bands via BAND_RATES + rateBandOf() in lib/shipping-rates.ts (classified by matching a country's Small-size rates, so it is a PRICE band not a region — e.g. NI prices on the Europe-West tier). Excludes Contact/Collection-only, Rest-of-World and the estimated/unlinked (DISPATCH) parcels, so the true gain is a touch higher (noted in the UI). Not in the PDF.
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
AI bookkeeping that automates the monthly NatWest/expenses spreadsheet (the one filled in by hand from invoices and bills). Flow: scan -> AI batch -> review -> database -> Excel export, deliberately built like the Auction AI batch run. You create a month (e.g. "April 26"), pick whose card a pile of receipts belongs to (B Goodall, J Goodall, James, Michael, or Vectis), and upload photos/PDFs. AI (Gemini) reads each document and pulls out the supplier, date, total and VAT, then suggests the VAT code (1 = 20%, 2 = none, 7 = personal) and the nominal column (Directors, Vectis, Fares, Fees, Other Debtors, Fuel, 21050, Meals, Computers, HGFP Stor, Card Fee). You review the lines in a table (fix anything, add lines manually for things with no paper receipt) and it learns: once you confirm a supplier it remembers the coding for next month. Export produces the April-26-style spreadsheet (grouped per cardholder with a VAT summary sheet) so it still slots in for the accountant. Scans stored in R2; data in AccountingMonth/AccountingDocument/AccountingSupplierRule; categories in lib/accounting.ts. Admin-only (financial data). The upload area shows three explained options — Take photo (camera), Choose files/PDF, and a Multi-page invoice toggle — each describing what it does. The VAT column holds a code: 1 = 20% VAT, 2 = no VAT, 7 = personal (shown as a legend on screen). There's an invoice Date column (the AI fills it from the document if it's shown). Newly added scans wait in a separate "To read" area (shown as thumbnails) where you tick which ones to read (Select all/none) — Run AI only reads the ticked scans and never re-does lines already in the table; once you Run AI and approve, they automatically drop into the main table. Each photo or file you add becomes a blank line straight away (just the image); you take them all, then press Run AI to read them in one go. Run AI doesn't write straight away — it reads everything then shows an Approve AI results confirmation listing what it will fill in for each document (including any splits); you Approve to apply or Cancel to discard, so nothing changes without your say-so. If a read is wrong you can redo it — once new scans are read the button becomes Re-read AI for any line not yet ticked OK, and each line's detail view has a Re-read with AI button. For a multi-page invoice, tick the Multi-page invoice toggle before scanning and every photo you take goes onto the same invoice (press New invoice to start the next); or open a line and use Add page / Add files. The thumbnail shows a page count, and the AI reads all the pages together as one invoice. If a single photo has several separate receipts on it — or you upload a PDF scanned from a stack of different invoices — Run AI automatically detects them and splits them into separate lines; for PDFs it uses two passes (one to work out where each invoice's pages are, then one to read each invoice) and each new line gets just its OWN pages sliced out of the PDF. If a file has more than 200 invoices the approve screen warns you to split it. PDFs are supported (the AI reads them); they show a PDF tile and open in the viewer's built-in PDF view. Clicking a page opens a full-screen viewer where you can zoom (buttons, scroll wheel, or pinch on an iPad), pan, and flick between pages (the AI fills supplier, item/service, website, date, total, VAT and suggests the code + column). Item and website are only filled if clearly visible on the document — the AI is told not to guess them. Clicking any invoice opens a detail view showing the full image next to its saved details (like the auction manager). The "whose card/account" list (B Goodall, J Goodall, James, Michael, Vectis) is editable on the Accounts index page — add, rename or remove cards; removing one keeps it on existing lines but takes it off the pick-list. The review screen is laid out like the spreadsheet (full width, fits without scrolling): lines grouped per card with a subtotal, and the nominal columns (Directors, Vectis, Fares, etc.) shown across; each line's net sits in its column and you click a column cell to file it there. Bank/card statement reconciliation is at /tools/accounts/[monthId]/reconcile (the month page has a blue Reconcile button at the top, in the header next to Export to Excel). All statements for the month are shown simultaneously (one section per statement, stacked). Upload a statement photo/PDF or import a CSV, assign it to a card, press Read (AI) to extract the transactions, then Auto-match or manually match each transaction to an entered invoice. The match dropdown shows only exact-amount matches (sorted by description similarity) rather than the full list; Auto-match now always picks the best candidate ranked by date then description. If a statement's matching goes wrong, the "Clear matches" button on that statement resets all its matches (and un-ignores) so you can run Auto-match again from scratch — the transactions are kept. If you've entered receipts that don't match the statement you're on because they belong to a different check (past or future), you can park them in a shared "Reserve" — click the ⤓ on a line in "Entered, but not matched" (or "Reserve all"). Reserved lines drop out of every month's table, export and matching so nothing gets mixed up. A Reserve panel at the bottom of every reconcile shows all parked lines (from any month, with their origin month); if one actually belongs to the check you're doing, "pull in" moves it into the current month ready to match, or "un-reserve" puts it back. The panel has a filter box and tickboxes so you can multi-select lines and pull or un-reserve them in bulk, plus a "Pull all shown" that pulls everything currently filtered into the month. There's also a "Reserves" page (a card on the accounts home page) that shows all parked lines in the same full grid as a month, so you can view and edit them in the familiar layout, pull a selection into a month, or un-reserve them. Reserving a line does remove it from its month's table, export and matching until you place it. (Needs Run Migrations once after deploy for the reserve flag.) If a bank payment has no invoice or receipt (and never will), you can mark that row "receipt missing" — it turns red, shows a badge, and stops counting as something still to match. The "Missing invoices" button in the reconcile header gives you ready-made email text listing exactly the payments you've marked as receipt-missing (date, description and amount), grouped by card, with a Copy button and an Open-in-email option — for chasing up the missing paperwork. (Needs Run Migrations once after deploy for the receipt-missing flag.) An "Unmatched only" toggle in the header hides the transactions that are already matched, so you can focus on what still needs doing. Some suppliers (like Google Ads) send one invoice for a big total but take the money in several smaller capped payments (e.g. £500 at a time) — so a single invoice can be matched to several bank transactions. When you match a payment to an invoice that's bigger than it, the dropdown offers it as "part of" that invoice, the invoice stays in the list showing how much is still outstanding, and once the payments add up to the total it's marked complete. Matched part-payment rows show how much of the invoice has been matched so far. The opposite also works: when the bank settles several small invoices in one chunk (e.g. lots of shipping receipts paid in one go), you can attach several invoices to the one transaction — pick one and it's added, the row shows "£X of £Y covered · £Z to go", and you keep adding lines until they add up to the payment (each attached line has an × to remove it). To save doing the maths, a "Smart match" button works out which combination of entered lines adds up to the payment and matches them all in one click (it favours lines from the same supplier and the fewest lines). You can move lines to a different month: tick them on the month table, pick the target month from the "Move selected to…" dropdown and click Move (useful if a receipt was filed under the wrong month). Each statement on the reconcile page has a "View" button that opens the uploaded statement photos/PDF full-screen so you can zoom in and read it. You can star a month to mark the one you're currently working on — starred months are pinned to the top of the list and highlighted, and the star is also in the month's header. (Needs Run Migrations once after deploy for the favourite column.) The Reconcile button and the month links now show a spinner the instant you tap them, so on a tablet you can tell the page is loading rather than wondering if your tap registered. Each statement section on the reconcile page can be minimised or expanded (it remembers which are collapsed), and there's a Collapse all / Expand all button. When expanded, each section shows a summary strip — number of transactions, total spend, how much is matched vs unmatched, any credits, ignored count, and the total of entered lines not yet matched. Rename a month using the "Rename" button next to the month title on the month page (or its label in the reconcile page header). "Export matched to Excel →" exports the same spreadsheet format but filtered to only the invoice lines that have been matched to a bank transaction. Lines that share the same date and amount for the same person get an orange "Possible duplicate" note that names the line it matches (the supplier), and the filter bar has a "Possible duplicates" quick-filter button (shown only when there are any) that narrows the table to just those flagged lines so you can compare them. The match is only within one person's lines — different drivers often spend the same amount (e.g. £120 of fuel) on the same day, which isn't a duplicate. Phase 2 later: smarter AI + a bank-CSV import for subscriptions/direct debits that have no receipt. **Auto match / Unknown card option (2026-07-07, STAGING):** the "Card / account" selector on the month page has a "🔍 Auto match / Unknown" option for invoices where you don't know whose card they belong to. Those docs are tagged with the reserved cardholder name "Unknown" (constant UNKNOWN_CARDHOLDER in lib/accounting.ts — a real non-empty string; NEVER encode Unknown as an empty string, blank cardholders get coerced to Vectis on save). Run AI now also extracts cardLast4 — the last 4 digits of the paying card printed on the receipt (new nullable AccountingDocument.cardLast4 column; also added to the transfer-import allowlist) — and matches them against the trailing 4 digits in the managed card names (e.g. "B Goodall 5895") via cardLast4FromName/resolveCardholderByLast4, assigning the card only when EXACTLY ONE name matches. Resolution runs client-side when building the Approve modal (which shows "Auto-matched via card ending NNNN" or "No card matched — stays in Unknown") and server-side in the apply route as a fallback for apply calls that post no cardholder (detail-modal Re-read, the Simple wizard's readAll). Unresolved docs group under their own "Unknown" section in the month table (and export) until reconcile: a card-scoped statement now matches against its own card's lines PLUS any Unknown lines (❓ prefix in the match dropdowns) — the scoping filter lives in THREE places that must be kept in step (autoMatchStatement in lib/actions/accounting.ts, scopedEntries in reconcile-client.tsx, statementState in wizard-client.tsx) — except an Unknown line whose stored cardLast4 DIFFERS from the digits in the statement card's name (excluded as a wrong-card signal). Matching an Unknown line (manually, Smart match, or Auto-match) STAMPS the document's cardholder with the statement's card so the month table and export file it correctly; setTransactionMatch and autoMatchStatement do the stamping and both revalidate the reconcile path too. Guards: "Unknown" is a reserved name (createCardholder/renameCardholder reject it) and the landing page's orphan-name detector excludes it (the merge UI would otherwise invite mis-tagging every unresolved line onto one real card); the localStorage card pin accepts it; the approve-modal and detail-modal card selects include it as an extra option. The Simple wizard's capture flow is deliberately unchanged (the option lives only in the admin selector), but wizard matching sees Unknown lines and stamping happens server-side. Needs Run Migrations once after deploy for the cardLast4 column.

### Saleroom Trainer (/tools/saleroom-trainer)
Iframe embedding /saleroom-trainer.html static training guide.

### Internal Warehouse (/tools/warehouse)
Vectis's own physical warehouse (separate from BC Warehouse). Dashboard + sub-pages: /customers, /receipts, /inbound, /locate, /history, /warehouse, /reports. DB models: Contact, WarehouseReceipt, WarehouseContainer, WarehouseMovement, WarehouseLocation.

### Admin (/admin)
**Overview grouped (2026-06-29)** into sections — People & Access / Cataloguing / Content & Communication / System & AI — on a full-width responsive grid (2 cols up to 6 on wide screens; dropped the old max-w-7xl 4-col cap). Cards: About, Users & Permissions, Roles & Defaults, Home Page Cards (/admin/home-cards — now grouped by the same sections shown on the hub: drag to reorder WITHIN a section, toggle visibility + featured, customise label/description; reworked 2026-06-18 to match the sections layout — previously a confusing flat ungrouped list. API /api/admin/app-cards returns each card's group; save flattens in grouped order so the global AppCard.order keeps sections contiguous. Which section a card belongs to is set in code via APP_CARD_DEFS.group. 2026-06-29: added Export / Import buttons — Export downloads the current setup as JSON (the same {key,order,visible,pinned,label,description} shape the Save PUT uses); Import loads a JSON into the editor matched by key, does NOT auto-save (admin reviews then clicks Save, going through the normal PUT) — used to match home-page setups across staging/main), Departments, Cataloguing Reports, Devices, Claude Memory, Run Migrations. Also: Backup (DB backup viewer in R2, cross-table search), Documents (nested folders, drag-and-drop R2 upload), Invoices (flat file store, any file type, R2 under invoices/ prefix, InvoiceFile model), Idle Timer (yellowMins/redMins/reasons, IdleTimerConfig singleton), **Lot Change Log** (/admin/lot-log — full audit trail of EVERYTHING that happens to a lot: who, what, when, and in which tool. Overhauled 2026-07-01 (previously logged only manual single-lot edits via updateLot — 1 of ~36 mutation paths). Now logs creation (with a summary of the details entered), every field edit from every path, deletion, and photo add/remove/reorder — via the shared lib/lot-log.ts helper (single choke-point; never write CatalogueLotEvent rows directly). New columns: action (created/updated/deleted/photo_*), source (which tool: lot_create/lot_editor/review_tab/photo_tab/ai_apply/bulk/import/mass_create/warehouse_fill/transfer/admin_db), batchId (groups one bulk action). Filters: auction/barcode/action/tool/field/user, paginated 50/page; estimate rows amber, cleared estimates red. In catalogue.ts single-lot updates route through updateLotLogged(); bulk updateMany paths snapshot-before then log changed lots under one batchId. Backup restore deliberately does NOT log. NEEDS Run Migrations (CatalogueLotEvent.action/source/batchId). **Cataloguing Categories** (/admin/categories — the category and subcategory list cataloguers pick from is now editable here: add, rename, reorder and delete both categories and their subcategories. It used to be fixed in the code. Changes show up everywhere lots are catalogued, on desktop and tablet; existing lots keep whatever category they already had. Needs Run Migrations once after deploy. 2026-06-26: the subcategory lists were synced to Business Central. First TRAINS got the 7 it was missing (Dapol O, Fleischmann HO, Heljan OO, Triang Hornby, Liliput, Mixed Lots, Rivarossi). Then, from the BC "Auction Statistics by Sub-Category" export, 211 more missing subcategories were added across 18 categories — the biggest being Military (had just 1 placeholder, now the full ~108 maker ranges: Britains, King and Country, Timpo, etc.), plus Sports, Kits, Star Wars and Collectables. Note: that stats export is your full auction history, so it includes some old/retired subcategories that are no longer used (proven by Trains showing 11 extras from an old item-type system) and a few BC typos/abbreviations; the retired Trains ones were left out, the rest were added as-is so they match BC exactly (any you don't want can be removed here). Adding a bulk list to an already-set-up system needs a Run Migrations step, because editing the default list in code only seeds a brand-new database.) **AI Models** (/admin/ai-models, added 2026-06-29 — pick which Gemini model each AI feature uses, per individual tool, grouped (Cataloguing / Auction AI / BC Marketing / IT / Accounts / Other). Central registry lib/ai-models.ts (AI_TOOLS slots + an async getToolModel(slot) helper, cached 60s), persisted in the ToolModel table. ~20 AI server routes now read getToolModel(slot) as their default model instead of hardcoding one — a user's on-screen per-session picker still overrides it. Dropdowns reuse the enabled-models list from /api/auction-ai/models. Built after Google retired gemini-2.0-flash and broke the cataloguing auto-fix + 3 other routes that all hardcoded it. Needs Run Migrations (new ToolModel table). When adding a NEW AI feature, add a slot to AI_TOOLS and use getToolModel — never hardcode a model. 2026-07-01: getToolModel now takes an optional client model — getToolModel(slot, clientModel) — and IGNORES a blank or RETIRED model (RETIRED_MODELS set), falling back to the configured default. All ~19 AI routes switched from clientModel || getToolModel(slot) to getToolModel(slot, clientModel). Fixes a class of bug where a stale client (old cached bundle on a shared iPad / old model saved in localStorage) posts a retired model name and hard-404s — it broke Review-tab auto-fix for cataloguers while working for the admin (fresh bundle). When Google retires a model, add it to RETIRED_MODELS. Standalone pickers (Lotting Up, Lot History, the 4 BC Marketing tabs, IT Help, IT Tools) now also START on the admin default via GET /api/ai-tool-model?slot=X on mount, unless the user has a saved override; the Auction AI sidebar stays a single shared live selector with the per-stage slots as server fallbacks. 2026-06-29 also added a "Set every tool to <model> / Apply to all" mass-set control, and MERGED the old Auction AI "Models" tab in as an "Available models" section on the same page — enable/disable + Test/Test all + descriptions — so it's all in one place.)

### Admin Centre — Lot Lookup (/tools/lot-lookup) — admin-only · added 2026-07-07
Card **"Admin Centre"** (🎛️ icon; renamed from "Lot Lookup" 2026-07-07 — route + APP_CARD_DEFS key stay LOT_LOOKUP, only the display label/icon/page-heading changed; intended as a home for admin tools, of which the lot lookup is the first) under the **Cataloguing & AI** hub section (the hub auto-renders cards with no DB seed/migration — order defaults to array index, visible defaults true). (Was briefly its own "Vectis Admin" section; Jordan moved it under Cataloguing & AI 2026-07-07.) **Grantable app since 2026-07-15** — was admin-only (no appKey, both page + API hard-gated on session.user.role !== "ADMIN"), which meant it had no tick box on the permissions page and could never be given to anyone. Jordan asked for it to be grantable, so it now has **appKey ADMIN_CENTRE** (new key in AppKey + ALL_APPS, label "Admin Centre") and both gates were switched to the standard hasAppAccess(role, allowedApps, "ADMIN_CENTRE") — admins still pass automatically, a non-admin needs the tick. It appears under Cataloguing & AI on both /admin/users/[id] and Roles & Defaults. No migration (allowedApps is an existing string[]). ⚠ Whoever holds it can look up ANY customer's lots by receipt/tote/vendor, so it stays off by default. The card key stays LOT_LOOKUP (matches the route + AppCard DB rows) while the appKey is ADMIN_CENTRE — they deliberately differ. Search by **Receipt / Tote / Customer (vendor) number** and see matching lots across BOTH systems side by side: **Hub cataloguing** (prisma.catalogueLot → catalogueAuction: which sale code+name, lot title/barcode, status, addedToBC) and **Business Central** (synced prisma.warehouseItem cache: catalogued yes/no + by whom, sale code+name, lot no, location — "as of last sync", used because live BC receipt lines lack the resolved sale NAME). API: /api/lot-lookup?type=receipt|tote|vendor&q= (401 unauthenticated, 403 without the app; page redirects to /hub). Key facts: CatalogueLot.vendor stores the C###### number (same as BC vendorNo) so vendor is matched EXACTLY on both sides (a substring match would leak other customers' lots — caught in review). **Tote search bridges via receipt**: a tote maps to WarehouseTote.receiptNo, and BOTH systems are queried by that receipt (BC never tags items with a tote, and CatalogueLot.tote is often blank) — so tote results are receipt-scoped and may include other totes on the same receipt (noted in the UI). Results grouped per sale (group key = code+name so blank-code sales don't merge); 500-row cap per side via take LIMIT+1 then slice. Live-BC-free, no migration.

### iPad Acceptable Use Policy — terms gate + signatures (2026-07-14) — app-wide · NEEDS Run Migrations
Every signed-in user must read + sign the iPad Acceptable Use Policy once before using the app. Blocking modal rendered by the app shell (app/(app)/layout.tsx) with a small Vectis logo letterhead: shows the policy (from lib/terms.ts — the TERMS structure + TERMS_VERSION; bump the version to re-prompt everyone), an "I accept" button, then a canvas signature pad (pointer/touch drawing + Clear; the pad surface is ALWAYS white so dark ink stays visible in dark mode, and the exported PNG is composited onto white), a note telling anyone unable to sign to speak to their manager, and Submit → POST /api/terms/accept (upserts TermsAcceptance, validates it's a non-trivial PNG data URL). **Enforced server-side:** when unsigned the layout does NOT render the app content (children) at all — the gate replaces it, so removing the overlay in dev tools reveals nothing behind it. Checks the REAL session user (not an impersonated one). New model **TermsAcceptance** (id, userId [no FK — decoupled from User, so zero login-lockout risk], userName, userEmail, version, signature TEXT [drawn PNG data URL, or an "admin:NAME" marker when an admin accepts on someone's behalf], acceptedAt; unique [userId, version]). Migration-safe: the layout check is wrapped in try/catch so the app still loads before Run Migrations (needsTerms=false → no gate). Admin view at **/admin/terms** ("Terms & Signatures", People & Access card, admin-only): who's signed (name / date+time / signature image) and who's outstanding, each with a "mark signed" safety-valve button (POST /api/admin/terms/mark, admin-only) for someone genuinely unable to sign — records an "admin:NAME" marker shown as a badge. Orphaned rows from deleted users are filtered out of the count. Timestamps are formatted with timeZone "Europe/London" — the page renders on the SERVER (Railway runs UTC), so without it BST times displayed an hour slow (fixed 2026-07-15; the stored acceptedAt was always correct UTC, it was display-only). Adversarial review found + fixed 5 issues (client-only overlay bypass, no admin remediation, dark-mode ink invisible, no blank-signature guard, orphan-count inflation). Also this session: the Vectis logo added centred in the top bar (components/top-bar.tsx) and the hub home page made full-width (removed the max-w-6xl cap, up to 6 card columns on wide screens). **NEEDS Run Migrations** (TermsAcceptance table).

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

**Understand the JOB before redesigning a screen.** On 2026-08-18 several rounds went into rearranging the Admin Centre from screenshots - collapsible groups, a totes table, button layouts - before anyone asked what the page was FOR. It exists because customers ring up asking where their things are, and the moment that was said the real faults were obvious in one pass: it was answering "which of our two systems is this lot in", which is the one thing the admin must never have to care about. If a screen keeps needing another tweak, stop and ask who uses it and what question they are answering.

**Common sense on confirmation.** You don't need to check with me on every small thing — fixing a bug, a TypeScript error, a styling tweak within an existing file is fine to just do. But if the decision involves WHERE something lives, WHAT it connects to, or anything that affects the structure of the app — ask first.

**Keep responses short.** One paragraph max unless explaining something technical. Lead with the action or answer, skip preamble. No summaries at the end, no "here's what I did" recaps.

**Don't give me commands to run — any of them.** Any admin operation that needs triggering manually must have a proper UI button. This also covers DIAGNOSTICS: don't paste a node/npm/browser-console line "so you can see the check for yourself". Run it yourself and tell me the result. (2026-08-17: a scratch test script got pasted at me as if it were something to run.)

**Refresh the changelog seed as part of EVERY push** (npm run changelog:seed, commit the result). Railway's build has no .git at all, so a release can only record its own headline commit — the committed seed is the ONLY route by which anything else reaches Admin → Patches & Changes. It went stale by 33 commits and a full day's work showed as one line (2026-08-17).

**Match the complexity of the solution to the simplicity of the request.** If I say "put a copy on the site", embed it statically — don't build a syncing system.

**Don't blame the cataloguers for the phantom report counts.** I've confirmed in person that nobody is making those lots, the barcode scanner isn't used, and the X-vs-F auction code is a red herring — it's an unidentified tablet/code trigger. Do not re-litigate this or suggest the users did it themselves.

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

receiptUniqueId: ⚠ the Hub mints NO unique IDs any more (2026-08-06, Jordan's decision) — a lot is created with receiptUniqueId = NULL everywhere (wizard, import, mass create, Photo Only), Change Vendor / End of Day tools no longer mint for blanks, and the ONLY population path is 🔗 BC Match & Import (bulkAssignUniqueIds — BC Lines export matched by barcode, writes BC's own UniqueID). The BARCODE is a lot's identifier until then; blank unique IDs pre-BC are the CORRECT state, never a bug to fix by re-adding minting. The old advisory-lock + MAX scheme (2026-06-17 fix) survives only in the uncalled fillLotsFromTotes — leave it dead. Still no DB unique constraint (historic dupes block it).

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

Cataloguing (/tools/cataloguing): Auction list (Active/Completed split, Complete toggle) with Export/Import xlsx. Per-auction tabs: Manage Lots (KP column ✓/— + Has KP/No KP filter; AI column 🚫 excluded/✨ upgraded; AI Excluded filter; Added By + Date Added columns; bulk Exclude/Unexclude from AI via bulkSetLotsAiExcluded), Add Lot, Photo Only, Import Lots, Upload Photos, AI Upgrade, Review (key points highlighted, error flagging, AI flag note amber banners + inline edit, AI-flagged only filter, fullscreen photo viewer — also on tablet), Statistics (Lots Missing Photos), Lot History, Auction Settings, **📤 Push to BC** (copy-paste BC-import builder — fills Short Description/estimates/Size Classification/categories matched by UniqueID, not position). CatalogueLot.aiFlagNote (TEXT nullable) — set by pipeline/recheck, cleared by saveLotDescription. bcLocked = auction.addedToBC && userRole !== "ADMIN". Lotting Up, Research, Tablet Mode.

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

Admin (/admin): About, Users & Permissions, Roles & Defaults, Home Page, Departments, Cataloguing Reports, Devices, Claude Memory, Run Migrations, Backup (R2 backup viewer + cross-table search), Documents (nested folders, drag-and-drop R2 upload), Invoices (flat file store, any file type, R2 invoices/ prefix, InvoiceFile model), Idle Timer (yellowMins/redMins/reasons config), **Lot Change Log** (/admin/lot-log — CatalogueLotEvent table; overhauled 2026-07-01 to log EVERYTHING via lib/lot-log.ts: creation with entered details, every field edit from every path, deletion, photo changes; with action/source(tool)/batchId columns + filters. NEEDS Run Migrations).

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
- Undo: **auto-detected in Scenario 1 only** (the rig clicks Undo when the Vectis amount drops below the last seen, until matched — card rule 6 updated 2026-08-04); manual on the shadow views and for clerk mistakes. Saleroom buttons have NO exclamation marks.

## Recent work (2026-08-13/14) — ⚠ SPLIT: some on production, most STAGING-ONLY

ON PRODUCTION (merged 2026-08-14, main = 9acfb0cd): Marketing Business Plan, the Auto Pipeline overnight queue, the photo-upload error message, and Jack's first two Lotting Up commits.
STAGING ONLY (10 commits, main is behind): everything marked (S) below — including both F109 data-safety fixes and the Auto Pipeline auto-apply fix.

- **Marketing Reports → Business Plan** — saved plans, AI suggestions from the analytics, A4 PDF. ⚠ The GA figures are FROZEN onto the plan; never make the page, the AI or the PDF read live GA. Marketing Reports is now **gated on its app permission** like every other tool (it wasn't — anyone logged in could open it), so anyone not ticked is bounced to /hub.
- **Auto Pipeline overnight queue** — queue several sales, each with its OWN settings, run SERVER-SIDE so nothing need be left open. ⚠ The tab's own Run button still runs in the browser. Never gives up on retries (Jordan's instruction).
- (S) **⚠⚠ Auto Pipeline "auto-apply isn't applying" — ROOT CAUSE FOUND.** Jordan's 512-lot Trains sale finished with everything unapplied; the log showed every write failing with "Server Action … was not found" — DEPLOY SKEW, caused by deploying while his tab was open. Every apply had its own catch that logged a line and carried on, so one deploy silently turned the rest of the sale into no-ops under a "Pipeline complete!". Worse, Apply All's catch was completely EMPTY — pressing it on a stale page wrote nothing, restored the list and said nothing. Both fixed, plus the mode is read live (toggling mid-run used to change the screen only), saveLot retries, and failed writes get their own red banner. ⚠ Do not deploy while Jordan has a long run going.
- (S) **⚠ F109 data safety — two separate faults, both spotted by Jordan.** (1) BC Match LOST A LOT: "594 BC rows · 595 our lots" with every count reconciling to 594. Two lots shared a barcode, the lookup map kept only one, and the loser appeared in NO category at all. It is now its own orange status, NEITHER lot is imported, and the panel checks its own arithmetic. (2) The DUPLICATE CHECKER OFFERED TO DELETE A REAL LOT — two different Steiff bears (F109630/F109631) had both ended up on R008767-129, and it grouped on unique ID alone. It now only deletes when the BARCODES agree; clashing IDs and clashing barcodes are read-only. Jordan fixed F109 by hand.
- (S) **Admin → Patches & Changes** — the development record plus an AI progress report for managers and a printable PDF. ⚠ The app has no GitHub access, so history is captured at BUILD time plus a committed seed. NO NAMES in the report (Jordan's call), and it is a LOG not a summary — no intro, every change covered.
- (S) **Description Copier — a real condition check.** The old popup fired on every visit saying the same thing. It now compares each lot's RECORDED condition against its description: missing / never graded / reworded, each listed as buttons that jump to the lot. ⚠ Grade matching is case-SENSITIVE so "a good example" is not read as a condition.
- (S) **Photo upload failures now say why** — one photo of 860 failed with Next's four-line "omitted in production builds" boilerplate. describeActionError turns that into one line plus the log reference, and names a stale deploy as such.
- (S) **Auction Manager** — a "Lots with photos" column showing e.g. 400/500, green once every lot has one.
- Jack's work rode along: Lotting Up gained sale-adding, whole-bench photo reading, a movable target band, 44px touch targets, and pricing from our own sold archive.

## Recent work (2026-08-04/05) — big session — ALL ON PRODUCTION (three merges to main, 2026-08-05)

- **End of Day → BC** — the headline: /tools/cataloguing/end-of-day generates the overnight hotkey sheet (every lot not yet in BC, barcode-matched vs the sync, grouped by tote, exact ToteNumber/LotCount/Barcodes format). Tote-check-powered **checks**, 🔧 **Fix what BC can prove** (loops the Tote Check autocorrect), **tick-and-move bar**, and 📝 **typed Mass re-map** (wrong → right lines, preview mandatory). ⚠ Run Data Sync first; only cross-tote duplicate barcodes ever come OFF the sheet (visibly).
- **Hub workflow captured** — ⚠ unique IDs are **PROVISIONAL** until 🔗 BC Match imports BC's own IDs (runs after each overnight macro); Push to BC runs once at the END after the AI pipelines; invoicing/customer accounts live entirely in BC + the website provider. **Barcode is the stable ID — never flag mid-flow unique-ID mismatches as errors.**
- **BC Warehouse Excel filters + PDFs** — shared FilterTable (Excel column dropdowns) on all 4 results tables; 🖨 PDF prints exactly what's on screen; totes columns gained Customer no, dropped Status/State.
- **Admin Centre rebuilt** — merged one-row-per-item Hub→BC journey + "Who catalogued this lot?"; "In BC" = **barcode** match (never addedToBC); lot no = currentLotNo; STATUS removed (again — don't reintroduce); oversized UI is deliberate. Plus a "Who catalogued this sale?" tab.
- **AI cost** — Claude prompt caching via cachePrefix (BC Source "ask the code" wired); run-cost estimate above Run on Batch/Pipeline; editable prices in Admin → AI Models (AiModelRate). ⚠ The Anthropic Console spend was NOT the Hub — check Console → Usage.
- **Auto Clerk review fixes** — rig undo rolls back S.hi; downward undo sync (watchdog stays upward-only); onlineBidAt replica feed kills phantom ROOM bids; gap-relay classifies sold/passed BEFORE bid substrings ("Sold to internet bidder" trap).
- **Devices** — ⬇ Export to Excel button.

## Recent work (2026-07-23/24) — reports + activity popup — now ON PRODUCTION (swept up by the 2026-08-04/05 merges)

- **Cataloguing Performance PDFs** — /tools/reports has **Summary (PDF)** (one-page team league table plus team-wide by-auction, by-reason and daily-output breakdowns) and **Export all (PDF)** (one clean page per cataloguer); clicking a name gives just that person. One route (/api/reports/pdf with ?summary=1 / ?range= / ?userId=) and one builder (lib/reports-pdf.ts). ⚠ Every figure is scoped to the selected period — Jordan rejected v1 for showing "Today" and "This week" columns inside a 30-day report.
- **"idle" removed from user-facing URLs** — now /admin/activity-timer, /admin/unaccounted-time and /tools/reports/activity; the old paths are redirect stubs. Code identifiers, DB tables (IdleLog / IdleGateDecision) and API routes still say "idle" — leave those alone. Jordan flagged the URLs twice, so don't let them drift back.
- **Activity popup reworked** — heading softened to "How was this time spent?", multi-select reasons, fully manual time sliders (nothing auto-adjusts — two earlier models were rejected), a live "Not allocated" figure, an "Other" reminder, and a warning on submit when time is left unallocated. Whole minutes only, rounded up.
- **⚠ Reporting knock-ons (fixed 2026-07-24) — the important bit.** The split writes SEVERAL IdleLog rows per break, which broke three things: unallocated time was **excusing gaps** in both the Unaccounted Time report and the save-gate (a real loophole, now excluded from both covering checks); breaks were counted per row (now per occasion via groupIdleOccasions); and "Most Common Reason" could read "Unallocated" (now excluded, with its own figure instead). If you change how the popup writes rows, re-check all three.
- **Preview buttons** on /admin/terms and /admin/activity-timer ("👁 Preview the popup"). ⚠ The activity popup's markup exists in TWO places — inline in lot-wizard-tab.tsx and in components/idle-prompt-preview.tsx — keep them in sync.
- **Admin → Data & Compliance** (/admin/compliance) — plain-English internal note on what data the Hub holds, where it lives, who it is shared with, with staff monitoring flagged as the priority area. Keep its lists updated whenever a new integration is added.

⚠ **The other developer pushes to staging too.** Always pull before pushing AND run a build after pulling — their commit broke the staging build once (pdf-lib's drawRectangle has no borderRadius option; it is a type error that fails the build).

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
- Don't add behaviour that wasn't requested. Build exactly what's asked.
- Phantom cataloguing report counts: NEVER blame the cataloguers (confirmed nobody makes those lots; scanner unused; X-vs-F is a red herring). Any new count of CatalogueTimingLog must exclude orphaned logs; when changing report/stat maths, verify the numbers still match before shipping.`,
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

Don't give Jordan commands to run - not to fix things, and not to check them either.

**Why:** He called this out when I told him to run fetch() in the console to trigger a migration. It happened again on 2026-08-17 in a subtler form: I finished a message with a "node ...scratchpad/gap2.mjs" line as evidence for a fix. It was a throwaway test on my own machine that he could not usefully run, and he had to ask "WHats that node thing you pasted?" - the harness renders shell-tagged blocks with a Run button, so it read as an instruction.

**How to apply:** Any admin operation that might need triggering manually must have a proper UI button (like the Run Migrations button). And VERIFICATION IS CLAUDE'S JOB, NOT HIS - run the check, then report the result in prose. Never paste a node/npm/console line as proof or as an invitation. If a check is worth him having permanently, it belongs behind a button in the app, not in a message.`,
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
    filename: "reference_access_log.md",
    content: `---
name: Access Log + the cataloguer /hub bounce
description: /admin/access-log diagnostic + what is RULED OUT in the /hub bounce investigation. Read before touching any app access gate or re-investigating the bounce.
metadata:
  type: reference
---

# Access Log + the cataloguer /hub bounce (2026-07-16)

**The bug (unresolved — evidence-gathering deployed, NOT a fix).** One cataloguer (role CATALOGUER, apps CATALOGUING + MANAGER_PORTAL) is *sometimes* thrown to /hub after pressing Save in the **desktop** Auction Manager Lot Wizard, and reports seeing only the Manager Portal card. **She just has to refresh the page** and it is fine again.

## ⚠ RULED OUT — do not re-investigate these

- **Nothing writes her permissions.** Every allowedApps writer is an admin action or a restore: /api/admin/role-defaults/apply, PUT /api/admin/role-defaults, /api/admin/users/[id]/apps, lib/actions/admin.ts (createUser), /api/admin/restore*, /api/databases/browse. **None fire on save, none run on a schedule.** "A refresh fixes it" independently confirms her stored row is intact — this is a **read/render** problem, not data loss.
- saveLastLotFields writes **only** lastTote/lastVendor/lastReceipt. It is **fire-and-forget** (.catch(() => {}), not awaited) immediately before onCreated() → router.refresh(), so a user.update does race the layout's user.findUnique — but Postgres MVCC cannot serve a half-row, so it cannot subtract an app.
- getEffectiveSession() returns early for non-ADMIN — **no impersonation** for her, no cookie read.
- **The JWT is stable.** auth.config.ts's jwt() callback only writes from \`user\` at sign-in and does **no** per-request DB re-query, so session.user.id cannot change between the bounce and the refresh. (Kills any "picked the wrong duplicate account per request" theory.)
- hasAppAccess is only \`role === "ADMIN" → true, else allowedApps.includes(appKey)\`. **Role is irrelevant** for a non-admin, so dbUser.role reading wrong cannot cause this.
- No cross-user cache exists: no unstable_cache, no React cache(), and the only module-level caches (lib/ai-models.ts, lib/ga.ts, lib/pdf-logo.ts) hold config/clients, not user data.

## The contradiction that forced the log

MANAGER_PORTAL and CATALOGUING are **both** appKey cards on the hub. If the read returned **null**, Manager Portal would vanish **too** (she'd get only allUsers cards) — contradicting the report. If it returned **her correct row**, the gate would have passed. A correct row cannot read as a *subset* of itself. So either the second-hand report is imprecise, or a render read **someone else's row** — and MANAGER_PORTAL-without-CATALOGUING is exactly what a **manager** looks like. Static reading cannot settle it; hence the log.

## What was built — /admin/access-log

- **AccessDenialLog** model (**NEEDS Run Migrations** — CREATE TABLE + 2 indexes are in app/api/admin/run-migrations/route.ts).
- **lib/access-log.ts** → logAccessDenied({ appKey, source, session, dbUser, note }). Captures BOTH sides: session id/email/name/role vs the row's id/email/role/allowedApps, plus referer and **idMismatch** (dbUserId !== sessionUserId). Wrapped in try/catch — **a diagnostic must never break the page it diagnoses**, and this also covers the pre-Run-Migrations window.
- ⚠ **isImpersonating / adminId / adminName are logged too, and this is essential.** getEffectiveSession() returns the impersonation **TARGET**, so session.user.id IS the target's id → **idMismatch reads false while impersonating**. Without these fields an impersonation problem is silently **misfiled as "the row genuinely lacked the app"**. The page checks isImpersonating **first** for the same reason. Relevant because **Test User has email IT@vectis.co.uk** and is filed under CATALOGUER, but the SUPERADMIN_EMAILS hardcode in auth.ts silently makes it **ADMIN** — an account that can sit on a cataloguing machine, **can** impersonate, and whose stale vectis-impersonate cookie would be honoured.
- **app/(app)/tools/cataloguing/layout.tsx** — the gate that does the bouncing. It now selects id + email **purely so a denial can be logged**, and calls logAccessDenied immediately **before** redirect("/hub"). ⚠ redirect() works by **throwing** — never wrap it in the try/catch.
- **/admin/access-log** (card under People & Access) — full-width table, migration-safe, "Clear log" button (DELETE /api/admin/access-log), no console needed.

**The page names the three failure shapes so the next occurrence is decisive:**
1. dbUserFound = false → **read returned nothing** (transient DB read; the gate fails closed via \`dbUser?.allowedApps ?? []\`).
2. idMismatch = true → **read a different user's row** (serious — cross-user permission read).
3. Row found, app absent → **her row genuinely lacked it** (would contradict "refresh fixes it" and mean something IS writing permissions).

## Separate real bug found on the way (NOT fixed, NOT confirmed as the cause)

auth.ts login uses prisma.user.findFirst({ where: { email: { equals: input, mode: "insensitive" } } }) with **no orderBy**. If one person ever has **two accounts** (e.g. differing email capitalisation), Postgres may return either row — so which account they log into is arbitrary. It would produce this exact symptom but does **not** explain "a refresh fixes it" (login picks the row, not the refresh). Worth an orderBy regardless. **Checked 2026-07-16 against the Users page — she is NOT duplicated**, so this is **not** the cause.`,
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

Server actions/API routes have no layout, so they must self-check the grant. lib/actions/catalogue.ts requireCataloguer() was broadened too (ADMIN/CATALOGUER, or any role with CATALOGUING in allowedApps), else a Manager could view cataloguing but got "Access denied" creating/editing lots. Audit 2026-06-17: all other role !== "ADMIN" gates are legitimately admin-only (Admin pages, Accounts, Job Board, role-defaults, backups, devices); follow-ups excluding CATALOGUER is intentional.

Admin-only cards vs grantable apps (2026-07-15): a card in APP_CARD_DEFS with NO appKey is admin-only — the hub renders it only for ADMIN and it gets NO tick box on the permissions page, because /admin/users/[id] and Roles & Defaults build their list from ALL_APPS filtered by an appKey→group map derived from the cards. So "an app is missing from permissions" almost always means "that card has no appKey", not a rendering bug. To make one grantable: add the key to AppKey + ALL_APPS in lib/apps.ts, set appKey on the card, switch its page + API gates to hasAppAccess. Done for Admin Centre 2026-07-15 (appKey ADMIN_CENTRE; card key stays LOT_LOOKUP). Still deliberately admin-only with no toggle: Admin (role-driven) and Job Board. Note BC_API_VIEWER is a card that shares BC_WAREHOUSE's appKey — card key and appKey need not match.`,
  },
  {
    filename: "reference_photo_upload_any_sale.md",
    content: `---
name: Photography -> Upload photos (any sale)
description: The existing uploader with no sale picked - matches codes across every UNCOMPLETED sale, and holds photos whose lot does not exist yet. Read before touching either uploader or lib/photo-scan.ts.
metadata:
  type: reference
---

Built 2026-08-17. Jordan: "Can I have a none auction specific ways to upload photos that automatches what auction the photos belong to", then decisively: "Its literally needs to be just like the existing photography section but auction less and checks it against all uncompleted sales to find matching ids". So it is NOT a new uploader - it is the existing one with the sale taken out. /tools/cataloguing/photography/any-sale, linked from the Photography list ("Upload without picking a sale").

⚠ ONE ENGINE, TWO SCREENS. lib/photo-scan.ts (BROWSER ONLY - canvas, zxing WASM) is the shared label-reading and grouping engine: resolvePhoto, buildGroups, parseBarcode, mapPool, toJpegBlob, readVectisWithZxingCpp, the types, safeName/nameFromKey. It was extracted out of photo-upload-tab.tsx when this was built, and components/photo-thumb.tsx is the shared HEIC-safe thumbnail. NEVER grow a second copy - two groupers that disagree would silently put a photo on the wrong lot.

PhotoUploadTab now takes auctionId: string | null, and each lot may carry its OWN auctionId + auctionCode. A lotSale map resolves lotId -> sale and the upload uses THAT, never the page's. A scope string ("this sale" / "any open sale") keeps the wording honest, and matched cards show a purple sale-code chip.

⚠ UNCOMPLETED SALES ONLY: where { ...auctionWhere(access), complete: false } - the same active/completed split the Photography list already draws. A finished sale must not quietly take new photos. 18 open sales / ~6,300 lots as built; the page loads ONLY id, barcode, receiptUniqueId and imageUrls, because descriptions and key points would multiply the payload and nothing on the screen reads them. Departments still apply (RULES.md) and the sales being searched are listed on the page, so a narrower scope is visible rather than mysterious.

⚠ SOONEST FIRST (Jordan, 2026-08-17). Both this page and the Photography sale list order by auctionDate ASC with nulls last, so the next sale to photograph is at the top and undated sales sit at the bottom rather than jumping the queue on a null. The COMPLETED list on the Photography page is sorted the other way (most recently held first) - "soonest" means nothing for a sale already held - and it is SORTED, not .reverse()d: reversing the ascending list would drag the undated ones from the bottom to the very top.

⚠⚠ A PHOTO THAT MATCHES NOTHING IS NOT SAVED AND NOT KEPT ANYWHERE. Jordan, 2026-08-17: "No dont store them if they dont match just forget about them". The uploader already lists those groups on the review and results screens ("not a lot in any open sale - won't save"), so nothing is hidden; they simply do not upload, and the photographer re-uploads once the lot exists.

⚠ DO NOT REBUILD THE HOLDING AREA. A HeldLotPhoto table, lib/held-photos.ts, an /api/cron/held-photos sweep, an attach hook inside bulkAssignUniqueIds and a "waiting for their lot" list were all built first, on his earlier answer that photos should be held until their lot appeared (the reasoning being that a file named with BC's unique ID matches nothing while the Hub lot's receiptUniqueId is still NULL until BC Match runs). He reversed it the same day and ALL of it was removed - the table was never created, so nothing was left behind. Do not propose it again without him raising it.

One thing worth keeping from that work, because it is a general trap: Prisma's mode "insensitive" works on equals/contains but NOT on in, so { barcode: { in: codes, mode: "insensitive" } } is a RUNTIME validation error, not a compile one. Use upper(btrim(col)) = ANY($1::text[]) in raw SQL if a case-insensitive multi-code lookup is ever needed.`,
  },
  {
    filename: "reference_smart_scan_photo_upload.md",
    content: `---
name: Smart Scan Photo Upload
description: How the cataloguing Upload Photos smart scan works — sequential barcode grouping, its failure modes, the 2026-07-15 rework, and how a failed photo's reason is reported
metadata:
  type: reference
---

⚠⚠ THE ENGINE DESCRIBED BELOW MOVED TO lib/photo-scan.ts ON 2026-08-17 - resolvePhoto, buildGroups, parseBarcode, mapPool, toJpegBlob, readVectisWithZxingCpp, the types and safeName/nameFromKey are all there now, with components/photo-thumb.tsx for the HEIC-safe tile. It is SHARED with Photography -> Upload photos (any sale), which runs the same grouping with no sale picked. NEVER grow a second copy - two groupers that disagree would silently put a photo on the wrong lot. PhotoUploadTab also now takes auctionId: string | null, and each lot may carry its own auctionId/auctionCode; the upload uses the LOT's sale, never the page's.

FAILED-PHOTO REASON WHEN THE ACTION THROWS (2026-08-13). uploadLotPhoto catches its own errors and RETURNS { ok:false, error }, so anything that reaches the client's catch is FRAMEWORK level — a stale deploy, a dropped connection, or an error Next has redacted. Jordan hit this on an 860-photo upload: one photo failed and the reason shown was the four-line "An error occurred in the Server Components render... omitted in production builds..." boilerplate, which tells nobody anything.

lib/action-error.ts -> describeActionError(e) now translates it into { message, digest?, staleDeploy }. A redacted error reads "the server hit an error it won't spell out on a live build. Reference <digest> — IT can look that up in the logs" (the digest is what matches it to the Railway log line, the same reference app/error.tsx shows). A stale-deploy miss says so and sets staleDeploy, which switches the panel's advice to "reload first". The failure box also now tells the cataloguer WHAT TO DO — upload the same folder again, since photos already saved are skipped — instead of only listing reasons.

WARNING: isSkewError is a TYPE PREDICATE. Do not alias its result: doing so narrows error to never in the later branches and .digest silently disappears (the same trap recorded in the deploy-skew entry). Reuse describeActionError for any other client catch around a server action rather than printing e.message raw.

The Upload Photos tab (photo-upload-tab.tsx) has two modes: Match by filename (barcode parsed from filename, _N suffix stripped) and Smart scan folder. Read this before touching either.

Smart scan mechanics: folder picker (webkitdirectory), image files only, natural filename sort. THE BARCODE READER IS zxing-cpp (WASM) as of 2026-07-15 — readVectisWithZxingCpp(file) calls readBarcodes(file,{tryHarder,tryRotate,tryInvert,tryDownscale}) from zxing-wasm/reader, keeps the first Vectis-format hit (letter+6-7 digits or unique-ID pattern; retail EANs rejected). Reads SERIALISED via a promise-chain mutex (serialiseZx) — the WASM has one shared memory and concurrent worker calls could race → a WRONG code (catastrophic). 1.1MB zxing_reader.wasm self-hosted at public/. decodeBarcode = zxing-cpp read ONLY. ⚠ Two guards added after review (2026-07-15): (1) ZX_READ_TIMEOUT_MS (30s) + zxReaderStalled — a serialised queue behind a wedged WASM read would hang the whole unattended scan forever, so a timed-out read flips zxReaderStalled, every remaining photo returns no code instantly (AI reads them) and it's logged to the feed; reset per scan via resetZxReader(). Do NOT remove the timeout — "runs to completion unattended" depends on it. (2) NO separate loadImgElement render-probe in decodeBarcode — that decoded every photo a THIRD time (zxing-cpp decodes it, then the AI prep's toJpegBlob decodes it again); the unreadable/HEIC flag is now captured in the AI prep from toJpegBlob returning null into unreadableSet (trade-off: if AI is skipped the HEIC count is unknown for unprocessed photos). This REPLACED the entire old JS pipeline (native BarcodeDetector + @zxing/library canvas/size/contrast/binarizer passes) which — proven via the debug tool — could not read some photographed labels (F091093: 0/84 passes) that a hardware scanner AND zxing-cpp read fine; zxing-cpp is also faster (one pass vs ~12 JS attempts/photo). @zxing/library remains a dep, used only by the Barcode debug tool. GROUPING RULE: a decoded barcode STARTS a group; the barcode/label photo itself is DISCARDED (never uploaded — intentional); following non-barcode photos join the group. Expected shooting pattern: label, then item photos, repeat. Matching: barcode → lot on barcode OR receiptUniqueId, case-insensitive. Upload: sequential per photo via uploadLotPhoto → R2, logged photo_added source photo_tab. BC lock blocks non-admins.

2026-07-15 rework (all six shipped together): (1) parallel decode, 3 at once, via an ORDER-PRESERVING pool (mapPool — grouping depends on file order; don't raise concurrency much, full-res canvases on iPads). (2) Photos before the first barcode go into preGroup, shown as a "won't be uploaded" thumbnail bucket (previously silently vanished). (3) Unreadable files (HEIC on Windows/Android, via Image.onerror) counted + orange warning that labels inside them can't be detected so lots may merge into the previous lot; they still upload fine as item photos. (4) Preview = thumbnail cards per group (object URLs in a ref Map keyed by File, revoked on reset/unmount; Thumb falls back to a tile for undisplayable formats). (5) Amber outlier flag on groups with photos.length >= max(6, 2×median) — the signature of a failed label scan merging two lots (scan mode only). (6) uploadLotPhoto RETURNS { ok, imageUrls | error } instead of throwing (production redacts thrown server-action messages); all four callers updated (photo-upload-tab per-photo failed list; auction-tabs / tablet-tabs / lot-photos-tab alert the real reason, e.g. the BC lock).

Post-review fixes (same day, 13-agent adversarial review, 8 confirmed findings → 5 distinct): zero-barcode error now explains unreadable/HEIC files instead of blaming focus (an all-HEIC folder — the feature's headline case — previously hit the generic "in focus" error); median uses the LOWER middle on even counts (upper median made the two-group merge case mathematically unflaggable); isFlagged requires a matched lot so the banner count equals the highlighted cards; all new warning boxes/card highlights got light-mode variants (were dark-only, ~1.5:1 contrast on light screens); done screen shows a red "Upload failed" banner when 0 uploaded, honest "X of Y to N lots" counts (okLotCount = lots that actually received ≥1 photo), failures as a list not a joined paragraph. Rejected finding worth remembering: 3× decode concurrency memory concern refuted — full-res canvas only exists on the native BarcodeDetector path, which iPads/Windows Chrome don't have; ZXing path caps at 2000px.

⚠ MULTI-STEP FLOW rework (2026-07-15, Jordan's spec — the current shape, replacing the auto-reconcile-in-the-grouping-loop below). Smart scan is now a phase machine: idle → scanning → discrepancies → preview(final review) → uploading → done. SOURCE OF TRUTH is a per-photo PhotoInfo[] (photoInfos state) aligned to scanFiles, NOT the groups — groups are DERIVED by the pure buildGroups(files, infos, lotMap) and rebuilt on every edit, which is what lets the discrepancy step and manual barcode entry re-flow the lots. Scanning: both the local reader AND the AI pass run over EVERY photo (execution order still scanner-then-AI internally — the proven stall-fix batch structure — though Jordan described it AI-first; two-stage progress shows "1 Reading barcodes" → "2 AI double-checking"). resolvePhoto(scannerCode, aiAnswered, aiIsLabel, aiCode) reconciles into a starting decision + flags a discrepancy: codes agree → label; codes differ → SCANNER wins (checksum) but flagged mismatch; scanner-code + AI-says-item → keep label, flag scanner-not-ai; AI-code + scanner-missed → accept, flag ai-not-scanner; neither but AI-says-label → label with NO code (needsCode), not a discrepancy; neither → item. DISCREPANCIES phase lists only flagged photos with thumbnails + choice buttons (Reader code / AI code / Not a label) → resolveDiscrepancy patches that photo + re-flows; defaults pre-applied so Continue always works; skipped entirely when none. FINAL REVIEW (preview) phase: stat tiles + notices + a Needs attention / All lots filter (default needs-attention so a 471-lot sale doesn't render everything); each lot card shows label photo + item photos; MANUAL FIX (scan mode only): hover any item/pre-first-label photo → 🏷 opens a modal to type the code → marks it a label (markPhotoAsBarcode, source manual) and re-flows following photos into the new lot; a needsCode label has 🏷 Type the barcode; EVERY scan-mode label (needsCode or not) has ✕ Not a label (unmarkLabel) merging it into the lot above (a review caught that gating this on !needsCode orphaned the following photos when AI wrongly flagged an item photo as an unread label — don't re-gate it); a "← Disagreements" button returns to the discrepancy step. Filename mode UNAFFECTED (no AI/discrepancies, groups the old way, manual tools hidden via missing labelIndex). LotGroup gained labelIndex/photoIndices/needsCode/edited; dropped aiVerdict/unreadableLabel/aiCode and dissolveGroup. — The AI mechanics that feed this (unchanged): After the local decode, ALL photos go to Gemini via POST /api/catalogue/scan-photos (model slot catalogue_smart_scan in AI_TOOLS — appears in Admin → AI Models). Per photo Gemini answers: label-photo-or-item-photo + the printed code if readable. Batches of ≤8 files / ≤12MB of ACTUAL payload, downscaled to 1000px JPEG client-side (toJpegBlob); browser-unreadable HEIC sent as originals (Gemini reads HEIC natively). Reconciliation of scanner-vs-AI is now the multi-step flow described above (resolvePhoto + discrepancy step + manual fix); EVERY group still stores labelPhoto (never uploaded — upload iterates g.photos only). The route rejects answer-count mismatches (500) and empty files (400) so misaligned answers can never mis-group photos. ⚠ Important context: built after a production scan showed 157 decoded-but-unmatched barcodes — AI does NOT fix that case (those barcodes decoded fine but weren't on lots in the auction); Jordan was told and chose to build it anyway (it fixes blurry/missed labels, misreads, false sticker groups and HEIC).

AI-fallback post-review fixes (same day, 25-agent adversarial review, 19 confirmed → 8 distinct): batches are sized by the ACTUAL payload (downscale first, then batch — sizing by original bytes collapsed batches to 1-2 photos and 8×'d the Gemini calls); the route REJECTS an answer-count mismatch with 500 (positional mapping means a model miscount would shift labels onto the wrong photos = silent mis-grouping) and 400s empty files (a 0-byte file used to silently truncate the batch); the retry loop never sleeps after the final attempt, never retries 422 content blocks, and short-circuits the whole AI pass after 2 consecutive failed batches (a 429 storm used to lock the scanning screen ~18 min); every AI fetch has a 150s AbortController timeout and the scanning screen has a "Skip AI check" button; 0-byte/oversize-skipped files set aiFailed so the UI never claims full AI coverage; unreadable-label cards have a "✕ Not a label" dissolve button (merges the group's photos back into the lot above, or the pre-barcode bucket if first) for AI false positives that would otherwise hold a lot's photos hostage.

⚠ THE 1093-PHOTO STALL (found live by Jordan on staging, fixed 2026-07-15) — read before touching the AI pass. The first AI-pass build prepared EVERY photo's payload (toJpegBlob) in one sequential loop BEFORE the batch loop, and progress only moved after the first batch completed. On a real sale (Trains Day 2, 1093 candidate photos) that meant 25+ minutes frozen on "0 / 1093" with no sign of life — downscaling needs a full-resolution decode per photo, so the prep loop alone was many minutes. Fixes: (1) batch by INDEX up front (instant), each batch prepares its own photos just before sending — progress moves within seconds; (2) batches run AI_CONCURRENCY(3) at a time via a worker pool, BATCH_SIZE 8 — 1000+ photos strictly sequential was far too slow; (3) prep stays SEQUENTIAL within a batch on purpose — 8-parallel × 3 workers = 24 concurrent full-res canvases (~30MB each) would risk an out-of-memory browser crash on a big sale; (4) a live aiNote line surfaces the real reason (rate limited / timed out / HTTP status / route error text) instead of a silent spinner, and an ETA appears after 24 photos. LESSON: any per-photo await loop that runs before the progress indicator moves is a stall on a 1000-photo folder — always report progress from the first item.

Smart backup-model rotation (2026-07-15, Jordan's "ping and pick the best backup" — built as reactive rotation because a ping only tells you a model is up+fast, not best at reading labels; the model that works IS the pick). At scan start a rotation shortlist = picked model, then the other ENABLED models (modelList) with "flash" ones first. Shared modelIdx (current) + struggle (failed attempts on current model since last success, reset on success); every 429/soft-fail does struggle++; maybeRotate() (synchronous so concurrent workers can't double-advance) → after ROTATE_AFTER(4) strikes it advances modelIdx (stops at last, no wrap), resets struggle/rlLevel/cooldownUntil (Gemini limits are largely PER-MODEL so a different model has its own quota), logs the switch. Header sends rotation[modelIdx]. Degrades gracefully if modelList not loaded (rotation=[primary], no backup). 429 bumps struggle (rotate) but NOT per-pack softFails (poison) — a rate limit isn't the pack's fault.

Model picker (2026-07-15): the Upload Photos tab has its own ✨ model dropdown on the idle screen, following the standard standalone-picker pattern — list from /api/auction-ai/models, default from GET /api/ai-tool-model?slot=catalogue_smart_scan, per-user override in localStorage["smart_scan_model"] with Set as default / clear. The choice is sent to the route in an x-ai-model HEADER (not the body — the body is multipart photo data) and resolved with getToolModel("catalogue_smart_scan", clientModel), so a blank/retired name still falls back to the admin default.

Concurrency traps in the AI pass (fixed 2026-07-15, found by review — all four are easy to reintroduce): (1) the give-up counter must be CONSECUTIVE, not absolute — an absolute "failures >= 3" abandoned AI review of the whole remaining folder after three UNRELATED blips scattered across a 137-batch run; now consecutiveFails resets on every success, threshold AI_GIVE_UP_AFTER = 4. (2) One AbortController ref cannot serve N workers — each worker overwrote it, so Skip aborted only the newest request and one worker's finally nulled another's controller; now a Set<AbortController> (aiAbortsRef) that Skip iterates. (3) The shared status line needs note ownership — a worker's success called setAiNote(null) and wiped another worker's live "rate limited" message; now each postPack remembers its own note and clears it only if it is still the one displayed. (4) The model picker must resolve the list + admin default TOGETHER — fetching the default only when no saved choice existed left the dropdown blank (silently falling back server-side) whenever a saved model had since been retired/disabled; now one effect Promise.allSettled's both and picks saved-if-still-enabled → admin default → first available. Also: "text-gray-500 dark:text-gray-600" is BACKWARDS for this app (dark is the default theme, so dark: must be LIGHTER) — use "text-gray-600 dark:text-gray-400".

⚠ The contrast pass didn't reach Jordan's devices (fixed 2026-07-15): decodeBarcode has three canvas treatments (normal / contrast(400%)+grayscale / hard-bw) but the CONTRAST one was only in the native BarcodeDetector loop, which does NOT exist on Windows desktop or iPad Safari — so on Jordan's real devices only the zxing fallback ran, and it only did normal+bw with HybridBinarizer, so the contrast boost never fired. This is why a faint SILVER label missed while near-identical silver labels beside it read fine — a low-contrast coin-flip, NOT size/angle/material (Jordan disproved all three with side-by-side successes). Fix: the zxing loop now runs normal/contrast/bw all with the proven HybridBinarizer — the contrast-boost pass (never wired into zxing before) is the lever for silver labels. ⚠ DO NOT add a second binarizer type (e.g. GlobalHistogramBinarizer) to the shared zxing reader — the first attempt did and it read NOTHING at all: the reader uses the stateful decodeWithState and mixing binarizer types corrupted its state so every following photo failed (found live by Jordan, reverted 2026-07-15). A second thresholding method would need a separate fresh MultiFormatReader + decode (not decodeWithState). The extra-thresholding half was dropped after it broke the reader; the contrast half stayed.

Unattended big-run reliability (2026-07-15, Jordan runs up to ~2000 images and won't babysit it): the AI pass now NEVER gives up on the rest of the folder — the earlier AI_GIVE_UP_AFTER/consecutiveFails short-circuit was REMOVED (don't reintroduce). postPack retries transient failures (429/network/timeout) UNLIMITED until they clear; only a 422 content block gives up that one pack immediately, and a persistent non-429 error gives up that one pack after POISON_CAP (8) tries (so one bad image can't loop forever) — in both cases only THAT pack's photos fall back to scanner-only, the run continues. Shared rate-limit gate: cooldownUntil + rlLevel shared across the 3 workers — a 429 pushes cooldownUntil = now + rlBackoff(rlLevel) (min(30s·2^(level-1),300s) → 30/60/120/240/300s) and waitForGate() makes ALL workers pause behind it (live "pausing Xs, carries on by itself" countdown), then resume; rlLevel eases off by 1 per good response. A retries counter → aiRetries state, shown in the final-review AI summary ("rode out N rate-limit/retry pauses on its own"). Skip still works (only way to stop early). ⚠ Runs WHILE THE TAB IS OPEN — closing it stops it (client-side; true resilience would need a server-side job, not built). RULES.md Batch-AI "infinite retry, never silently fail" applied to the scan. Live activity feed + escalation panel (2026-07-15): the AI stage shows a compact timestamped feed (aiLog, last 14 NOTABLE low-frequency events only — start / each rate-limit pause / back-to-normal / per-500-photo milestones / poison drops / skip — NOT per batch) and an escalation panel that appears only once AI has been in trouble >2 min (troubleSince/troubleRef, set on first 429/soft-fail, cleared on next success; the per-second cooldown re-render drives the check) spelling out the options (leave it / Skip to barcode-only). logEvent is component-scope so Skip can log too. ETA fix (review-found): "N min remaining" uses an etaBaseTime/etaBaseDone baseline that RESETS on rate-limit recovery and is hidden during a pause — otherwise averaging in the up-to-5-min cooldown read "about 800 min remaining" and looked broken.

⏭ "Don't add a photo the lot already has" (2026-08-10, Jordan: "so when I get new photos I can just upload the folder in bulk again and it wont duplicate the photos"). A tickbox on the idle screen, DEFAULT ON, persisted in localStorage["photo_upload_skip_duplicates"], applying to BOTH modes. NO SCHEMA CHANGE was needed — uploadLotPhoto stores every photo at lot-photos/{auctionId}/{lotId}/{Date.now()}-{safeName}, so the original filename is recoverable from the key: nameFromKey(key) = basename with the leading \\d+- stripped, compared CASE-INSENSITIVELY against safeName(file.name) (Windows treats IMG_1.JPG/img_1.jpg as one file). ⚠ Compare the BASENAME, never key.endsWith(name) — that matches "IMG_1.jpg" against a stored "X-IMG_1.jpg". photography-client.tsx now passes imageUrls into PhotoUploadTab (the Photography page already selected it for the progress bar) — that is the only wiring. handleUpload copies existingNames into a mutable "seen" map and ADDS each successful upload to it, so a filename repeated twice inside one folder is caught too. ⚠ uploadedCount is derived as uploadProgress.done − skipped.length − alreadyCount — done counts skipped photos as well, so omitting alreadyCount over-reports "saved"; and re-picking a folder with nothing new gives uploadedCount === 0, which would otherwise hit the red "Nothing was saved / all failed" banner, so there is now a blue "Nothing new to save" banner for that case. Both are easy to break — keep them. Reported everywhere (never silent): an "Already there" stat tile (results grid widened to 5), the per-lot rows ("N saved, M already there") and the summary line. The label photo is only re-saved when ok > 0, so a pure-duplicate re-upload doesn't duplicate label photos either.

Quirks kept deliberately: the label photo is discarded by design; filename mode reverses photos within each group (highest _N first — matches the lot-photos-tab "Main" convention); duplicate barcodes later in a folder create a second group for the same lot (both upload to it).`,
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
- [New Claude Account Setup](reference_new_claude_account.md) — Steps to replicate this full Claude Code setup on a new account (permissions, hooks, memory, project files)
- [App Access Control](reference_app_access_control.md) — hasAppAccess + per-app layouts, NOT role lists; "app missing from permissions" = card has no appKey
- [Smart Scan Photo Upload](reference_smart_scan_photo_upload.md) — Upload Photos smart scan grouping rules, failure modes, and the 2026-07-15 rework
- [Photography Section](reference_photography_section.md) — /tools/cataloguing/photography; Upload Photos removed from Auction Manager; new sidebar sections are hidden from users with configured sections
- [Upload photos — any sale](reference_photo_upload_any_sale.md) — the same uploader with no sale picked: matches codes across every UNCOMPLETED sale, shared engine in lib/photo-scan.ts, and photos whose lot doesn't exist yet are HELD and attach on BC Match`,
  },
]

export default async function MemoryPage() {
  const jordan = await isJordan()
  const visible = ENTRIES.filter((e) => jordan || !JORDAN_ONLY.has(e.filename))
  return <MemoryClient entries={visible} />
}
