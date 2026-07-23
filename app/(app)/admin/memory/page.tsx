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
    filename: "activity_popup_preview.md",
    content: `---
name: Activity popup preview — /admin/idle-timer
purpose: The "Preview the popup" button + the caveat that the activity-popup markup lives in two places.
last_updated: 2026-07-23
---

# Cataloguer Activity Timer — preview the popup (2026-07-23)

Admin → Cataloguer Activity Timer (/admin/idle-timer) has a **"👁 Preview the popup"** button so admins can see the activity/away popup exactly as cataloguers get it, driven by the reasons they've configured on that page. Read-only — nothing is saved (✕ + amber "Preview" badge; the action button just closes). Component: **components/idle-prompt-preview.tsx** (\`<IdlePromptPreview reasons={reasons} />\`).

⚠ **The activity popup markup now exists in TWO places — keep them in sync:**
1. The REAL popup — inline in the lot wizard: app/(app)/tools/cataloguing/auctions/[id]/lot-wizard-tab.tsx (search "What were you doing?"). Wired to idle detection + the save flow.
2. The preview REPLICA — components/idle-prompt-preview.tsx.

If you restyle/restructure one, do the other. It wasn't extracted into a shared component because the real popup is tightly coupled to the wizard's idle refs / save flow — safer to replicate for a preview than to refactor the critical cataloguing path. (Same "preview the popup" idea as the terms gate, but that one was already a component so it's reused directly in a guarded preview mode.)`,
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

⚠ KEEP IT IN SYNC: when the Hub gains a NEW third-party integration, data store, or staff-monitoring feature, update the STORES / PROCESSORS / MONITORING arrays in that page. Linked from the Admin overview grid ("System & AI", ⚖️ icon).`,
  },
  {
    filename: "dolls_bears_descriptions.md",
    content: `---
name: Dolls & Bears descriptions — tuning
purpose: The recurring model errors, the deterministic clean-up, the "Dolls & Bears check" upgrade mode, and why bold was dropped. Read before touching the Dolls/Bears instruction or batch/upgrade cleanup.
last_updated: 2026-07-22
---

# Dolls & Bears descriptions — tuning (2026-07-21)

The Dolls & Bears presets produce bulleted lot descriptions; the instruction TEXT is DB-managed (Auction AI → Instructions). Instruction-only iteration kept failing the same mechanical mistakes, so the fix is split three ways.

⚠ **Bold was tried and DROPPED.** An earlier version used markdown \`**bold**\` for names, but nothing renders it (the Review tab's HighlightedDescription doesn't parse markdown; website + BC take raw text) so \`**\` showed literally on every lot. Descriptions are PLAIN TEXT — do not reintroduce \`**\`.

Recurring errors:
- Mechanical (fixed in code): literal \`**\`; "LE 6000" not "limited edition 6000"; the "plumo means…" reminder note printed in; the item name repeated after the dash; a stray space in the code ("CB 114790").
- Judgement (need AI/instruction): "x three" (→ "a trio of"); guessing/wrong animal type (a brown bear called a "panda"); thin openings; routine "designed by [name]"; broken grammar.

Fixes (built 2026-07-21):
1. Deterministic clean-up \`lib/description-cleanup.ts\` \`cleanBearsDescription()\` — strip **, LE→limited edition, remove "plumo means…" AND any plumo expansion ("plumo (plush with mohair and alpaca accents)" → "plumo", buyers know the term), de-dupe repeated name, close "CB 114790". Applied in /api/auction-ai/batch (scoped isBearsPreset) and /api/auction-ai/upgrade (dolls_bears_fix mode) — NOT the Chat route.

⚠ Keep the instruction LEAN (Jordan): the prompt goes in on every lot, so verbosity raises cost AND makes the model follow fewer rules. Slimmed to ~40% (judgement/format/estimate only); mechanical rules live in the clean-up. Applies to AI prompts generally.
2. Instruction tightening for the judgement calls.
3. New "🧸 Dolls & Bears check" AI Upgrade mode (dolls_bears_fix) — an AI pass over EXISTING descriptions fixing both, plus the clean-up. In the AI Upgrade tab and the pipeline's upgrade step.

## 2026-07-22 — descriptive-sentence restyle + KP strict/relaxed mode

1. Instruction restyled to flowing sentences (modelled on onemorebear.co.uk): bullets KEPT, but each "• Name – " is now one or two descriptive sentences (measured auction tone — no gushing, no invented backstory, no he/she unless in key points), ending "Product code X, 16"/41cm." Edition woven in as "a limited edition of 6,000". Jordan pastes it into Auction AI → Instructions; still in the test loop.
2. Root cause the restyle exposed: the Key Points stage was UNDOING the flowing style — KEY_POINTS_INSTRUCTION (lib/key-points-instruction.ts) replaces approximate phrasing with the cataloguer's exact wording, crunching sentences back to telegraphic fragments.
3. Built strict/relaxed KP mode: new KEY_POINTS_INSTRUCTION_RELAXED (same file, same JSON contract) lets the checker reword key-point FACTS to fit the sentences; names/codes/editions/sizes stay character-exact; layout/bullets preserved. /api/auction-ai/key-points-check takes mode "strict"|"relaxed" (absent = strict = old behaviour). Tickboxes on BOTH the KP Check tab (localStorage kp_check_relaxed) and the Auto Pipeline options row (pipeline_kp_relaxed). The instruction viewers (pipeline ShowInstructionToggle + KP tab HowItWorksPanel) show the ACTIVE variant — the stale hardcoded KP_SYSTEM_PROMPT display copy was deleted.
4. Per-auction Review tab matching mode — ⚠ the Review tab is the HUMAN check on the AI; it must NEVER auto-trust the AI's own KP verdict (that idea was proposed and REJECTED). CatalogueAuction.reviewKpMode "strict"|"relaxed" (default strict, NEEDS Run Migrations), chosen in Auction Settings ("Exact wording (e.g. trains)" / "Relaxed wording (e.g. Dolls & Bears)"). analyseKeyPoints (lib/kp-analysis.tsx) gained a mode param + a "reworded" status: relaxed holds the digit-bearing hard tokens (sizes/editions/codes — which the relaxed AI instruction forbids rewording) to an exact match; all present but wording different → amber "reworded — check wording" (still an issue, human reads it); any hard token absent → red "not found". Strict = old behaviour except two accuracy fixes in both modes: unit equivalence (13 inches ≡ 13", N cm ≡ Ncm — normalised on the key-point side only, never the description) and exact numbers ("250" no longer false-passes on "2500" or on the tail of "1,250"; 1,500 ≡ 1500 both ways; 13-inch/34cms tolerated). ⚠ Matcher traps (adversarial-reviewed + regression-tested): a spaced bare "in" after a number is the PREPOSITION ("24 in the set") and must never be fused into an inches token; comma-grouped KP numbers are de-comma'd key-point side before tokenising; NO regex lookbehind (old Safari on the shared iPads throws at compile time). Only the Review tab passes a mode; the AI Upgrade tab call site stays strict.`,
  },
  {
    filename: "idle_report.md",
    content: `---
name: Idle Report — /tools/reports/idle
purpose: The team-wide idle report page (for non-technical managers). What it shows + data sources + PDF export. Read before touching it or the reports section.
last_updated: 2026-07-22
---

# Cataloguer Activity Report — /tools/reports/idle (2026-07-21)

Team-wide activity report in the cataloguing reports section — a new page, linked from the /tools/reports overview via the amber "⏱ Activity Report" button. REPORTS access.

⚠ NAMING (renamed 2026-07-21): "idle" is banned in user-facing text (implies doing nothing). UI now says "Cataloguer Activity"; the time metric = "Away / time away". Renamed LABELS everywhere (this page, /admin/idle-timer = "Cataloguer Activity Timer", /admin/idle-gaps = "Unaccounted Time", popup heading = "What were you doing?"). Code identifiers, DB tables (IdleLog/IdleGateDecision), API routes and page paths (/tools/reports/idle etc.) STILL use "idle" — do NOT change those.

⚠ Written for non-technical MANAGERS — plain English, no dev jargon. Jordan rejected the first version's technical/empty cards. Keep language plain and keep it feature-rich.

- Page: app/(app)/tools/reports/idle/page.tsx (server) + idle-report-charts.tsx (client, recharts). Time-range pills via ?range.
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
- durationMs=0 / "no timing log" starved gate — WRONG: he HAS timing logs (counted in /tools/reports AND shows on /admin/idle-gaps).
- Per-user config — his scan timer is ON, 30-min threshold.
- "Everyone has unexplained gaps", not just him — the report alone can't single him out.
- Production running an older gate — it is a bit behind staging, but Jordan says that's not the issue.

## Confirmed vector
The on-screen popup works out "is it 9–5" from the PHONE's clock. He's believed to set the phone to a US timezone / 2am so the popup thinks it's outside working hours and never nags him. The SERVER save-block already uses the server clock (immune), so the clock trick shouldn't let him actually create lots across a real gap — the exact remaining leak wasn't provable from code, so we added a log to catch it.

## Built (STAGING; Jordan merges to prod out of hours)
- lib/idle-gate.ts evaluateIdleGate() — one server-authoritative decision (server clock + Europe/London working hours + DB save times) shared by the create-lot gate AND /api/catalogue/last-activity (the popup). So the phone clock/timezone can't silence the popup any more.
- Client checkIdleOnLotStart uses the server's shouldPrompt when online; device time only as an offline fallback.
- IdleGateDecision table (NEEDS Run Migrations): createLot logs each meaningful save's decision + what the DEVICE claimed (clientNow, clientTz) + userAgent. Admin viewer on /admin/idle-gaps ("Save-time gate decisions") flags any save whose clientTz ≠ Europe/London or clock >10 min off server — the smoking gun. Logging is best-effort (never breaks a save).
- Gate hardening: a covering idle log must cover ≥ half the gap to clear; the ">=8h day off" skip only applies across a real day boundary.
- (Earlier same-day pass, still valid: createLot always writes the timing log; timer starts on barcode onFocus; reports ignore durationMs=0 for speed.)

The decision log is the point: once on production it will show exactly what his phone reports at each save.`,
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

## ⚠ Research-only cataloguers 404'd the detail page (fixed 2026-07-22)
/tools/reports/[userId]/page.tsx keyed the display name AND its notFound() off a timing log (\`anyLog = catalogueTimingLog.findFirst({where:{userId}}); if (!anyLog) notFound()\`). But the overview list unions timing-log AND research-log users, so someone with ResearchLog rows but zero CatalogueTimingLog appeared in the list and 404'd when clicked. Fix: resolve userName from the User record (user.findUnique) with fallbacks to rawLogs/researchLogs/idleLogs[0].userName, and only notFound() when the name is genuinely unresolvable (bad URL) — never on "no lots in range". Don't reintroduce the timing-log-only gate. It surfaced right after a prod deploy so it looked like deploy skew, but was a real latent bug (a hard refresh did NOT clear it).`,
  },
  {
    filename: "idle_gaps_detector.md",
    content: `---
name: Idle-gap detector — tamper-proof backstop to the idle popup
purpose: /admin/idle-gaps unexplained-gap report. Read before touching idle detection.
last_updated: 2026-07-20
---

# Unexplained idle gaps — server-side detector (2026-07-20)

Built after a cataloguer had a ~4h working-hours gap between lot saves with zero idle logs — the client idle popup was being circumvented. The exact client mechanism couldn't be pinned from the data, so the fix is a tamper-proof server-side backstop (Jordan's call: detector now, harden the client after).

- **lib/idle-gaps.ts** — pure detector: working-hours gaps between consecutive lot saves over the user's own threshold, each marked explained (a matching idle reason was logged) or not. Skips gaps of a full working day+ (days off).
- **/admin/idle-gaps** — ADMIN-ONLY full-width report. Date range, groups by cataloguer, flags unexplained gaps, shows a scan-timer-OFF badge. Reads the save history directly, so it catches the gap however the in-app popup was avoided. Linked from Admin → Idle Timer + its own Admin card.
- The popup itself has no dismiss button — it can't be closed without logging a reason.

## Server-side gate (2026-07-20 — the real fix)
The bypass was closing the app / signing out / reloading, which resets the client's idle baseline. Fix: enforce the gate SERVER-SIDE in createLot. If a cataloguer's next lot comes after a working-hours gap over their own threshold with no idle reason logged, the server refuses to create it and the app shows the popup — once they log the reason it saves. Because it reads the save history, closing/reopening/logout can't get around it. The FIRST lot of the day gets a 30-minute start-of-day grace (a normal ~9–9:30 start is fine); go past it and it gates, showing the idle spanning from the last save so an early finish yesterday shows alongside a late start today. Any logged reason (Holiday included) counts as accounted-for. Working hours are computed in Europe/London server-side (Railway is UTC); the report and gate share one function (assessGap).`,
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

3. **Remove Conditions** — strips the exact "Condition appears <condition>." sentence Add appends.

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
- Review tab (shared review-tab.tsx, also on tablet): photo (tap for modal; each image has hover "⛶ Fullscreen" → full-screen overlay), key points with ✓/≈/⚠ markers (word-level stem matching), description with per-KP colour highlights. Filters: search, cataloguer, issues dropdown (All lots / ⚠ With issues / ✓ All good), Flagged-only, **AI-flagged only toggle** (filters to lots with aiFlagNote). THREE DISTINCT things: "with issues" = hasIssues() (any key point missing/partial OR no description OR no photos OR reviewFlag); "Flagged only" = human reviewFlag; "AI-flagged only" = aiFlagNote. The header "⚠ N with issues" count is a CLICKABLE button (2026-06-24) toggling the issues filter — previously users clicked the flag buttons expecting those lots and got nothing. Error flagging: setLotReviewFlag action. **AI flag note:** CatalogueLot.aiFlagNote (TEXT nullable) — set by pipeline batch when AI spots a potential cataloguer mistake; shown as amber ⚠️ banner with two options: "Edit description to fix…" (inline textarea, saves + clears flag) and **"Ignore (AI is wrong)"** button (calls saveAiFlagNote(id, null) to dismiss without editing). A lot with an active edit textarea is always kept in filtered results regardless of active filters. Key point analysis shared lib: lib/kp-analysis.tsx (analyseKeyPoints, HighlightedDescription, kpColour) — imported by review-tab.tsx and AI Upgrade tab. Save-description error UX (2026-07-01): failures now show INLINE at the Save button (saveErr state) instead of the far-off top banner (cataloguers on a long/tablet list couldn't see it and thought Save "did nothing"). Bigger fix same day: in production Next.js REDACTS a thrown server-action error's message to the generic "Server Components render" string, so a cataloguer editing a BC-LOCKED auction (addedToBC=true → requireNotBCLocked blocks non-admins; admins bypass — hence "works for admin, not cataloguers") saw gibberish. Fixed by making saveLotDescription/setLotReviewFlag/saveAiFlagNote RETURN {ok,error} instead of throwing, and showing res.error. Button shows "Saving…" via useTransition pending. THEN (2026-07-01, per Jordan) those three Review actions were made to BYPASS the BC lock entirely — the Review tab is QA/corrections and cataloguers may fix lots even after the auction is in BC; the lock still applies to the wizard/Manage Lots/updateLot, delete, bulk actions and transfer. Don't re-add requireNotBCLocked to the three Review actions.
- **Upload Photos tab — Smart scan rework (2026-07-15, photo-upload-tab.tsx):** the "Smart scan folder" mode reads Vectis barcodes (F066001 / R000016-413 formats only — retail EANs rejected) from a folder of photos and groups them sequentially: a barcode photo STARTS a lot group (the label photo itself is discarded, never uploaded), following photos join it until the next barcode. Reworked in one pass: (1) scanning is now PARALLEL, 3 images at once via an order-preserving pool (mapPool — results land at their file's index so grouping order is untouched); (2) photos before the first barcode are no longer silently dropped — collected into preGroup and shown in the preview as a warned "won't be uploaded" bucket with thumbnails; (3) files the browser can't decode (HEIC from iPhones on Windows/Android) are counted as "unreadable" with an orange warning that labels inside them can't be detected (they still group + upload fine as item photos — Thumb component falls back to a 🖼️ tile); (4) the preview is now thumbnail CARDS per group (object URLs cached in a ref Map keyed by File, created in makeThumbs, revoked on reset/unmount) instead of a filename text table, so misfiled photos are visible before upload; (5) groups with photos.length >= max(6, 2×median) get an amber "unusually many photos" flag — the signature of a label that failed to scan merging two lots (scan mode only; filename mode grouping is deterministic); (6) uploadLotPhoto (lib/actions/catalogue.ts) now RETURNS { ok, imageUrls | error } instead of throwing (production redacts thrown server-action messages — same fix pattern as the Review tab actions); all four callers updated (photo-upload-tab per-photo failure list, auction-tabs / tablet-tabs / lot-photos-tab alert the real reason, e.g. the BC lock). Done screen counts uploaded = attempts − failures. No migration.
- **Photo Only Cataloguing tab** (lot-photos-tab.tsx): per-lot panel shows photos with teal border + "Main" label on index 0, gray "Photo N" labels on others, original filename underneath each thumbnail. "↕ Reverse order" button (2+ photos) calls reorderLotPhotos action. On filename-based import, photos within each lot group are **reversed** (highest-numbered file → main). R2 key format: 'lot-photos/[auctionId]/[lotId]/[Date.now()]-[safeName]' (preserves original filename; old format had no filename). Lot wizard also shows filenames under photo thumbnails.
- **Lot Wizard** (lot-wizard-tab.tsx): 8 sequential steps — 1 Vendor & Tote, 2 Barcode, 3 Key Points, 4 Categories, 5 Estimate, 6 Condition, 7 Parcel Size, 8 Photos. Step dots are NOT clickable (advance via Next/Back only). Required fields are enforced in validateStep(s) which blocks Next (error shown above the nav): step 1 vendor+tote+receipt (receipt made required 2026-06-25), step 2 barcode, step 5 estimate low+high, **step 7 parcel size (made required 2026-06-24 — needed for the BC Size Classification column; parcel stored in CatalogueLot.notes)**. Required labels show a red *. Field checks are only a soft 7-character length warning (bypassable) + maxLength 7 — no strict pattern check. Remember-last (2026-06-25): Tote/Vendor/Receipt persist per USER ACCOUNT (User.lastTote/lastVendor/lastReceipt columns — NEEDS Run Migrations) so they follow a cataloguer across shared iPads and survive closing the app; wizard pre-fills blank fields on open via getLastLotFields() and saves via saveLastLotFields() after each createLot (barcode still uses localStorage). **Step-1 rework (2026-07-07):** removed the Tote/Vendor/Receipt **Pin buttons** (category Main/Sub pin kept). **The tote is now the source of truth** — typing/selecting a tote ALWAYS overwrites vendor+receipt (the old "only if blank" guards in selectTote/lookupVendorFromBC caused a changed tote to keep the previous vendor/receipt = the mismatch bug), and editing the tote text clears the derived vendor/receipt so a not-in-BC tote can't keep stale values. Step-1 nav button is **"Start cataloguing →"** (startCataloguing → validate → 7-char gate → commitStart), which sets 'locked' {tote,vendor,receipt,vendorName} and advances; the values carry across every lot (no pins). Changing mid-batch: the step-2 "Change Tote / Vendor" chip runs **changeVendor()** (wipes tote/vendor/receipt for a clean re-entry, keeps 'locked'), and pressing Start with values differing from 'locked' opens a **confirmation modal** ("change vendor to X · tote · receipt", shows current). Receipt→vendor reverse lookup only runs when NO tote is set (tote wins). goBack() now clears barcodeWarning/step1LengthWarning (else the Start button stayed disabled back on step 1). Client-only, no migration. **Spell flagging on Key Points / Description (2026-07-07):** step 3 lists unrecognised words underneath the textarea ("⚠ Possible spelling mistakes: …") — FLAG ONLY, no auto-fix/suggestions (Jordan's choice). Fully client-side + offline via lib/spellcheck.ts: lazy-fetches a 274k-word British/English list from public/dict/en-words.txt (built once from the an-array-of-english-words package, then committed; ~2.7MB, gzips to ~800KB, loaded only when step 3 is first reached), builds a Set, debounced 400ms. Deliberately NOT flagged: brand names (reuses the wizard's BRANDS_LIST, split into tokens), all-caps codes (LNER/GWR/BR), any token with a digit (catalogue numbers, scales like R2290 / 1:76), tokens under 3 chars, and a small VECTIS_TERMS allowlist (diecast/playworn/approx/vgc/…). Hyphenated words check each part. Fails open (network error → no flags). No AI, no network round-trip per lot, no migration. **Separate box/packaging condition (2026-06-24, extended to all editors 2026-06-25):** checkbox under the main condition reveals a Wording picker ("Box is" / "Packaging is" / Custom free-text) plus the same grade selector with its own optional "to" range. Saved as a separate sentence on the condition — e.g. "Near Mint to Excellent. Box is Good to Good Plus." Only added when the box is ticked AND a prefix AND grade are set. Now available in all three lot editors via shared lib/condition.ts (parseCondition/buildCondition/CONDITION_GRADES): the Lot Wizard (buttons), the desktop auction-manager editor (buttons, autosaves) and the tablet editor (dropdowns). Wizard only builds; desktop + tablet also parse the stored string back into the fields. Edit lib/condition.ts to change the format. Wording presets are DB-managed (2026-06-25): the "Box is"/"Packaging is" picker is driven by the ConditionWording table, seeded with Box is / Packaging is / Carded Back is / Blister Card is (format "<wording> is" so it reads "Carded Back is Mint"). Read via useConditionWordings() hook + /api/catalogue/condition-wordings; managed (add/rename/reorder/delete) at Admin → Condition Wording (/admin/condition-wording, admin-only). Each editor also keeps a per-lot Custom free-text wording. NEEDS Run Migrations on staging (ConditionWording table).
- Auctions list page: split into Active and Completed tables. Complete column is an interactive toggle (CompleteToggle → toggleAuctionComplete). **Filterable** (2026-06-26) via a shared filter bar (search code/name + Type dropdown + status dropdown) in the client component auctions-tables.tsx; both tables filter together and show a (count). Each auction Type shows a **fun emoji** (🚂 trains, 🚗 diecast, 🎬 TV/film, 🧸 bears, etc.) on desktop + tablet lists + the New Auction dropdown — single source of truth in lib/auction-types.ts (auctionTypeEmoji/auctionTypeLabel/AUCTION_TYPES).
- Manage Lots table: Added By (createdByName, sortable), **KP column** (✓/— with Has KP / No KP filter), **AI column** (🚫 excluded / ✨ upgraded), **AI Excluded filter**.
- Manage Lots mass actions: mark/unmark added to BC, generate titles, transfer, delete lots, 📷🗑 Delete photos (bulkClearLotPhotos), **🚫 Exclude/Unexclude from AI** (bulkSetLotsAiExcluded)
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
Scheduled sync: /api/cron/bc-warehouse (server interval scheduler, CRON_SECRET) loops receipt-lines to completion then auction-lines/changelog/totes/totes-active/auction-names — but INCREMENTAL only, so newly-added columns need a one-time full re-sync (Data Sync → amber Full re-sync button) to backfill historical rows; the cron then maintains them. Data Sync shows a "Shipping column coverage" line (total items · with collection · with size, from /api/warehouse/sync/status) to confirm a full re-sync populated the Shipping report columns.

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

**Common sense on confirmation.** You don't need to check with me on every small thing — fixing a bug, a TypeScript error, a styling tweak within an existing file is fine to just do. But if the decision involves WHERE something lives, WHAT it connects to, or anything that affects the structure of the app — ask first.

**Keep responses short.** One paragraph max unless explaining something technical. Lead with the action or answer, skip preamble. No summaries at the end, no "here's what I did" recaps.

**Don't suggest console commands.** Any admin operation that needs to be triggered manually must have a proper UI button.

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
    filename: "reference_smart_scan_photo_upload.md",
    content: `---
name: Smart Scan Photo Upload
description: How the cataloguing Upload Photos smart scan works — sequential barcode grouping, its failure modes, and the 2026-07-15 rework
metadata:
  type: reference
---

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
- [Photography Section](reference_photography_section.md) — /tools/cataloguing/photography; Upload Photos removed from Auction Manager; new sidebar sections are hidden from users with configured sections`,
  },
]

export default async function MemoryPage() {
  const jordan = await isJordan()
  const visible = ENTRIES.filter((e) => jordan || !JORDAN_ONLY.has(e.filename))
  return <MemoryClient entries={visible} />
}
