// The overnight Auto Pipeline worker — the server-side twin of the Auto Pipeline
// tab's run loop.
//
// Why it exists: the tab's pipeline runs entirely in the browser, so a run only
// continues while that tab is open and the PC is awake. This one is driven by
// the background loop in server.js, so a queue of sales — each with its own
// instruction, model and toggles — works through the night with nothing open.
//
// ⚠ IT CALLS THE SAME ROUTES THE BROWSER DOES (/api/auction-ai/batch,
// key-points-check, double-check) over localhost, authenticated with
// CRON_SECRET. That is deliberate: those routes hold heavily-tuned prompts, the
// key-points rules, the bears clean-up and the English rule. Re-implementing any
// of it here would drift from what the tab produces within a release. If a
// prompt needs changing, change it in the route — both paths get it.
//
// ⚠ NEVER GIVES UP (Jordan, 2026-08-13). A lot that errors is left UNMARKED and
// retried — across ticks, across restarts, forever, with the same backoff the
// browser uses. The single exception is the one already in RULES: a Gemini
// CONTENT BLOCK skips that lot, because it will never succeed on retry
// (RECITATION excepted — it is stochastic, so it retries on the other model).

import { prisma } from "@/lib/prisma"
import { shouldKeepFlag } from "@/lib/measurement-check"
import { logLotFieldChanges } from "@/lib/lot-log"
import { keepConditionLine } from "@/lib/condition"
import { HEARTBEAT_STALE_MS } from "@/lib/pipeline-queue"

// ── Tunables ────────────────────────────────────────────────────────────────
/** How long one tick works for before saving and handing back. Well under any
 *  sensible restart window, so little is repeated if the server bounces. */
const SLICE_MS = 9 * 60 * 1000
/** Same inter-lot gap the browser run uses, to stay under Gemini's rate limits. */
const LOT_GAP_MS = 12_000
/** Rate-limit backoff, matching the client: 60s → 120s → … capped at 30 min. */
const rateLimitWait = (attempt: number) => Math.min(60_000 * Math.pow(2, attempt - 1), 1_800_000)
/** Everything else: 12s → 24s → 30s. */
const otherWait = (attempt: number) => Math.min(attempt * 12_000, 30_000)
/** ⚡ QUICK MODE — the gap finds its own level instead of assuming the worst.
 *  The flat LOT_GAP_MS above exists because Gemini was measured at about four
 *  requests a minute during a rate-limit storm, and that figure has been the
 *  pace of every overnight run since. On a 601-lot sale the waiting alone is
 *  nearly five hours across the three stages, so if the real quota is higher
 *  the sale is being slowed for nothing (Jordan, 2026-08-28: "the overnight
 *  runs take so long"). Quick mode starts short, doubles the moment a request
 *  is refused, and eases back after a clean run — the same adaptive scheme the
 *  Locking Check's Suggest conditions already uses. Worst case it widens back
 *  out within a couple of minutes and the sale is no slower than before. */
const FAST_START_MS = 4_000
const FAST_MIN_MS   = 2_000
const FAST_MAX_MS   = 60_000
/** Clean lots in a row before the gap narrows again. */
const FAST_EASE_AFTER = 10
const MAX_RECITATION_RETRIES = 4
/** How many times to re-ask when a call succeeds but produces no text at all. */
const MAX_EMPTY_RETRIES = 4
/** The route's wording for that case — kept in one place so the two cannot drift apart.
 *  Also covers the two TOOL-CALL failures, which are the same thing wearing different hats:
 *   · a LEAKED tool call — the model writing out print(google_search.search(…)) as its answer;
 *   · MALFORMED_FUNCTION_CALL — the model fumbling a real one, which Gemini reports as a finish
 *     reason (2026-09-02).
 *  Different causes, identical handling: the answer is unusable, so re-ask on the other model a
 *  few times rather than saving it or throwing the lot away. */
const EMPTY_ANSWER = /returned no description|empty description|leaked tool call|malformed[_ ]function[_ ]call/i

const LOG_MAX = 40_000 // keep the morning report readable and the row small

// ── Problem lines are PINNED, never trimmed ─────────────────────────────────
// ⚠⚠ THE LOG IS A TAIL: `.slice(-LOG_MAX)`. On F113 (1,547 lots) two comics
// were blocked and skipped, and by the morning the two lines saying WHY had
// been pushed out by ordinary progress — the row sat at exactly 40,000
// characters with no trace of either (Jordan, 2026-08-28: "nothing returns
// saying why it's blocked"). The lot record only ever said "skipped", so the
// reason existed nowhere at all.
//
// So the handful of lines that explain a lost lot are held in their own block
// at the TOP of logText, outside the trim. Stored in the text rather than a
// column on purpose: the runner works in ~9-minute slices with nothing in
// memory between them, so this has to survive in the row it already writes.
const PROBLEMS_HEAD = "⚠ PROBLEMS — kept in full, never trimmed"
const PROBLEMS_TAIL = "── the run log follows ──"
const PROBLEMS_MAX  = 8_000
/** ✗ = a lot lost, ↻ = a retry that explains one. Both are what a morning
 *  reader needs; ordinary ✓ progress is what gets trimmed. */
const isProblemLine = (l: string) => /✗|↻/.test(l)

function splitPinned(text: string): { pinned: string[]; body: string } {
  if (!text.startsWith(PROBLEMS_HEAD)) return { pinned: [], body: text }
  const end = text.indexOf(PROBLEMS_TAIL)
  if (end === -1) return { pinned: [], body: text }
  const pinned = text.slice(text.indexOf("\n") + 1, end).split("\n").filter(Boolean)
  return { pinned, body: text.slice(end + PROBLEMS_TAIL.length).replace(/^\n+/, "") }
}

type Ctx = { changedBy: string; source: string }

// ── Talking to our own routes ───────────────────────────────────────────────
function base(): string {
  return `http://localhost:${process.env.PORT ?? 3000}`
}
function cronHeaders(extra: Record<string, string> = {}): Record<string, string> {
  return { Authorization: `Bearer ${process.env.CRON_SECRET ?? ""}`, ...extra }
}

type Lot = {
  id: string
  label: string
  keyPoints: string
  imageUrls: string[]
  currentDesc: string
  batchStatus?: string
  kpStatus?: string
  dcStatus?: string
  appliedDesc: string
}

/** ⚠⚠ MALFORMED_FUNCTION_CALL IS NOT A REFUSAL. Gemini returns it when it fumbles a tool call —
 *  the same family as the leaked `tool_code` text, not a decision about the content. It arrives
 *  worded as "Blocked (MALFORMED_FUNCTION_CALL)" because every non-STOP finish reason is thrown
 *  that way, so `isBlock` matched it and the lot was skipped INSTANTLY and reported as "content
 *  blocked" — one lot lost from F116 on an overnight run (Jordan, 2026-09-02). It is stochastic
 *  and clears on the other model, so it belongs with the bounded retries below. */
const MALFORMED_CALL = /malformed[_ ]function[_ ]call/i

/** Gemini refused this one — it will never succeed on a retry, so the lot is
 *  skipped and reported rather than blocking the sale forever. */
function isBlock(err: string): boolean {
  if (MALFORMED_CALL.test(err)) return false
  return err.toLowerCase().includes("block")
}
function blockReasonLabel(err: string): string {
  const m = err.match(/BLOCKED:\s*(.+)$/i) || err.match(/\(prompt\):\s*(.+)$/i) || err.match(/Blocked\s*\(([^)]+)\)/i)
  const reason = (m?.[1] ?? "").trim().replace(/[.\s]+$/, "")
  return reason ? `content blocked (${reason})` : "content blocked by AI"
}
function parseEstimate(est: string): { low: number; high: number } {
  const m = (est ?? "").match(/£([\d,]+)\s*[–\-]\s*£?([\d,]+)/)
  if (!m) return { low: 0, high: 0 }
  return { low: parseInt(m[1].replace(/,/g, "")), high: parseInt(m[2].replace(/,/g, "")) }
}
function titleFromDescription(desc: string): string {
  const text = (desc ?? "").replace(/[\r\n]+/g, " ").trim()
  if (!text) return "Untitled"
  return text.length > 83 ? text.slice(0, 82) + "…" : text
}

// ── Writing to the catalogue ────────────────────────────────────────────────
// The tab uses the applyAiDescriptionOne server action, which requires a
// session. This has none, so it does the same work here — and logs it exactly
// the same way, because RULES: every path that edits a lot MUST log through
// lib/lot-log.ts. The change log will show these as "Auto Pipeline (overnight)".
const LOGGABLE: any = {
  id: true, auctionId: true, barcode: true, title: true, description: true,
  aiEstimateLow: true, aiEstimateHigh: true, aiFlagNote: true,
  auction: { select: { code: true } },
}

async function updateLotLogged(lotId: string, data: Record<string, any>, ctx: Ctx): Promise<void> {
  const old = await prisma.catalogueLot.findUnique({ where: { id: lotId }, select: LOGGABLE })
  await prisma.catalogueLot.update({ where: { id: lotId }, data })
  if (old) {
    await logLotFieldChanges(
      old as any, data,
      { id: (old as any).id, auctionId: (old as any).auctionId, barcode: (old as any).barcode, title: (old as any).title },
      (old as any).auction?.code ?? "", ctx,
    )
  }
}

// ⚠ Raising a flag is a lot mutation and MUST be logged (RULES.md — every create/edit/delete
// goes through lib/lot-log.ts). These three writes used to be bare prisma.catalogueLot.update
// calls, so a flag raised overnight left NO entry in the Lot Change Log while the identical
// flag raised from the Auto Pipeline tab did (which goes through saveAiFlagNote →
// updateLotLogged). Stamped "ai_flag" like the browser path, so the only difference between
// the two in the log is changedBy.
const flagCtx = (ctx: Ctx): Ctx => ({ ...ctx, source: "ai_flag" })

async function applyDescription(lotId: string, description: string, ctx: Ctx): Promise<void> {
  // ⚠⚠ Keep the lot's condition line. The AI never writes one, so an apply used to take
  // "Condition appears …" straight back off any lot that had it — the overnight run does
  // this hundreds of times a night. See keepConditionLine in lib/condition.ts. (2026-09-01)
  const before = await prisma.catalogueLot.findUnique({
    where: { id: lotId }, select: { description: true, condition: true },
  })
  const text = keepConditionLine(before?.description, before?.condition, description)
  await updateLotLogged(lotId, {
    description: text,
    title: titleFromDescription(text),
    aiUpgraded: true,
  }, ctx)
}

async function applyEstimate(lotId: string, low: number, high: number, ctx: Ctx): Promise<void> {
  await updateLotLogged(lotId, { aiEstimateLow: low, aiEstimateHigh: high }, ctx)
}

// ── The per-sale run ────────────────────────────────────────────────────────

type Item = Awaited<ReturnType<typeof prisma.pipelineQueueItem.findFirst>>

class Deadline {
  constructor(private readonly at: number) {}
  get expired(): boolean { return Date.now() >= this.at }
  get leftMs(): number { return Math.max(0, this.at - Date.now()) }
  /** Can we afford to wait this long and still do useful work afterwards? */
  fits(ms: number): boolean { return Date.now() + ms + 20_000 < this.at }
}

/** Thrown to unwind out of the lot loops when the slice's time is up. `waitMs`
 *  is set when we stopped because a backoff wouldn't fit — the item then sleeps
 *  that long before the next tick picks it up, so a rate limit isn't hammered. */
class SliceOver extends Error {
  constructor(public readonly waitMs: number = 0) { super("slice over") }
}

export type SliceResult =
  | { ran: false; reason: string }
  | { ran: true; code: string; status: string; done: number; total: number; stage: string; message: string }

/** Code deploys instantly; migrations are applied by hand afterwards. This loop
 *  ticks every 30 seconds, so without this the gap between the two would fill
 *  the production logs with the same Prisma error twice a minute. */
function isMissingTable(e: any): boolean {
  return e?.code === "P2021" || e?.code === "P2022" || /does not exist in the current database/i.test(e?.message ?? "")
}

export async function runQueueSlice(): Promise<SliceResult> {
  if (!process.env.CRON_SECRET) return { ran: false, reason: "CRON_SECRET not set" }

  const now = new Date()

  // Someone else is already on it. A RUNNING item with a fresh heartbeat means a
  // slice is in flight; a stale one means the server restarted mid-sale and this
  // tick should take it over.
  let running: Item
  try {
    running = await prisma.pipelineQueueItem.findFirst({ where: { status: "RUNNING" }, orderBy: { position: "asc" } })
  } catch (e: any) {
    if (isMissingTable(e)) return { ran: false, reason: "queue table not created yet" }
    throw e
  }
  if (running && running.heartbeatAt && now.getTime() - running.heartbeatAt.getTime() < HEARTBEAT_STALE_MS) {
    return { ran: false, reason: `already running ${running.code}` }
  }

  // Resume the interrupted sale first, otherwise take the next one waiting whose
  // backoff has expired.
  const item: Item = running ?? await prisma.pipelineQueueItem.findFirst({
    where: { status: "QUEUED", OR: [{ retryAfter: null }, { retryAfter: { lte: now } }] },
    orderBy: [{ position: "asc" }, { createdAt: "asc" }],
  })
  if (!item) return { ran: false, reason: "nothing to run" }

  const resumed = !!running
  // Claim it conditionally: if another tick got there first the status will have
  // moved on and this update matches nothing, so we bow out rather than run the
  // same sale twice.
  const claimed = await prisma.pipelineQueueItem.updateMany({
    where: { id: item.id, status: item.status },
    data: {
      status: "RUNNING",
      retryAfter: null,
      heartbeatAt: now,
      ...(item.startedAt ? {} : { startedAt: now }),
    },
  })
  if (claimed.count === 0) return { ran: false, reason: `${item.code} was claimed by another tick` }

  const log: string[] = []
  const addLog = (msg: string) => {
    const ts = new Date().toLocaleTimeString("en-GB", { timeZone: "Europe/London", hour: "2-digit", minute: "2-digit", second: "2-digit" })
    log.push(`[${ts}] ${msg}`)
  }
  if (resumed) addLog(`▶ Picked ${item.code} back up (the server restarted or the last slice ran out of time)`)
  else addLog(`▶ Starting ${item.code}`)

  // ⚠ updateMany, not update, and never over a PAUSED/CANCELLED row.
  // Two reasons, both of which bit in testing:
  //   · Hold pressed mid-slice sets PAUSED — a plain update at the end of the
  //     slice would quietly set it back to QUEUED and the sale would carry on,
  //     which is exactly the "nothing happened, but it says it worked" trap.
  //   · Remove pressed mid-slice deletes the row — update() would then throw
  //     inside the error handler. updateMany simply matches nothing.
  const flush = async (fields: Record<string, any>) => {
    // Pull the pinned problems back out, add any new ones, and trim only the
    // BODY — see PROBLEMS_HEAD above for why this exists.
    const { pinned, body } = splitPinned(item.logText ?? "")
    const allPinned = [...pinned, ...log.filter(isProblemLine)]
    let cropped = false
    while (allPinned.join("\n").length > PROBLEMS_MAX && allPinned.length > 1) { allPinned.shift(); cropped = true }
    const head = allPinned.length
      ? `${PROBLEMS_HEAD}${cropped ? " (oldest dropped)" : ""}\n${allPinned.join("\n")}\n${PROBLEMS_TAIL}\n`
      : ""
    const newBody = (body + (body ? "\n" : "") + log.join("\n")).slice(-(LOG_MAX - head.length))
    const merged = head + newBody
    const { status, ...rest } = fields
    // Progress and the log are always saved — losing them on a pause would throw
    // away the record of work that really happened.
    await prisma.pipelineQueueItem.updateMany({
      where: { id: item.id },
      data: { ...rest, logText: merged, heartbeatAt: new Date() },
    })
    // The STATUS is only ever moved on a row nobody has taken control of.
    if (status !== undefined) {
      await prisma.pipelineQueueItem.updateMany({
        where: { id: item.id, status: { notIn: ["PAUSED", "CANCELLED"] } },
        data: { status },
      })
    }
    log.length = 0
    item.logText = merged
  }

  /** Has someone pressed Hold, or taken the sale off the queue, since the last
   *  lot? Checked between lots so a click takes effect in seconds rather than at
   *  the end of a nine-minute slice. */
  const stopRequested = async (): Promise<boolean> => {
    const row = await prisma.pipelineQueueItem.findUnique({ where: { id: item.id }, select: { status: true } })
    return !row || row.status === "PAUSED" || row.status === "CANCELLED"
  }

  const deadline = new Deadline(Date.now() + SLICE_MS)
  const ctx: Ctx = { changedBy: `Auto Pipeline (overnight${item.addedBy ? `, queued by ${item.addedBy}` : ""})`, source: "ai_apply" }

  try {
    const state = await loadLots(item)
    if (!state) {
      await flush({ status: "CANCELLED", finishedAt: new Date(), lastMessage: `Couldn't load ${item.code} — the sale wasn't found.` })
      return { ran: true, code: item.code, status: "CANCELLED", done: 0, total: 0, stage: item.stage, message: "sale not found" }
    }
    const { lots, staleCleared } = state
    // ⚠ Say it out loud. A run that quietly re-does 210 lots looks identical to one that
    // quietly skips them, and the whole fault this guards against was invisible until the
    // change log was read by hand.
    if (staleCleared > 0) {
      addLog(`  ↻ ${staleCleared} lot${staleCleared === 1 ? "" : "s"} had been emptied in the catalogue since the last run — running ${staleCleared === 1 ? "it" : "them"} again`)
    }

    if (item.kind === "upgrade") {
      addLog(`   AI Upgrade · ${item.upgradeModes.split(",").filter(Boolean).join(", ")} · everything held for morning review`)
      await runUpgradeKind(item, lots, deadline, addLog, flush, stopRequested)
      await flush({ status: "DONE", stage: "complete", finishedAt: new Date(), lastMessage: `Finished ${item.code} — the rewrites are waiting for review.` })
      addLog(`🎉 ${item.code} complete — open the run to review and accept the rewrites`)
      return { ran: true, code: item.code, status: "DONE", done: item.done, total: item.total, stage: "complete", message: "complete" }
    }

    addLog(`   ${lots.length} lots in scope · ${item.preset || "no instruction"} · ${item.autoApply ? "auto-apply" : "review before applying"}`)

    await runStages(item, lots, deadline, addLog, flush, stopRequested, ctx)

    // Every stage finished within this slice.
    await flush({ status: "DONE", stage: "complete", finishedAt: new Date(), lastMessage: `Finished ${item.code}.` })
    addLog(`🎉 ${item.code} complete`)
    return { ran: true, code: item.code, status: "DONE", done: item.done, total: item.total, stage: "complete", message: "complete" }
  } catch (e: any) {
    if (e instanceof SliceOver) {
      const wait = e.waitMs
      addLog(wait > 0
        ? `⏳ Backing off for ${Math.round(wait / 1000)}s — ${item.code} will carry on after that`
        : `⏸ Slice over — ${item.code} will carry on shortly`)
      // Stays QUEUED (not RUNNING) so a stale heartbeat can't make another tick
      // think it crashed; the retryAfter is what holds the backoff.
      await flush({
        status: "QUEUED",
        retryAfter: wait > 0 ? new Date(Date.now() + wait) : null,
        lastMessage: wait > 0 ? `Waiting ${Math.round(wait / 1000)}s before carrying on.` : "Carrying on shortly.",
      })
      return { ran: true, code: item.code, status: "QUEUED", done: item.done, total: item.total, stage: item.stage, message: "paused for the next tick" }
    }
    // ⚠ Anything else is still NOT a failure — never give up. Back off and let
    // the next tick have another go, exactly as the browser loop would.
    addLog(`✗ ${item.code} — ${e?.message ?? e}. Will try again in a minute.`)
    await flush({ status: "QUEUED", retryAfter: new Date(Date.now() + 60_000), lastMessage: e?.message ?? "Unknown error — retrying." })
    return { ran: true, code: item.code, status: "QUEUED", done: item.done, total: item.total, stage: item.stage, message: `error, retrying: ${e?.message ?? e}` }
  }
}

// ── Loading ─────────────────────────────────────────────────────────────────
// Mirrors the tab's handleLoad so the same lots are in scope, including the two
// filters. Reads through the same routes, so one definition of "the lots".
async function loadLots(item: NonNullable<Item>): Promise<{ auctionId: string; lots: Lot[]; staleCleared: number } | null> {
  const code = item.code.trim().toUpperCase()
  const catRes = await fetch(`${base()}/api/auction-ai/catalogue-lots?code=${encodeURIComponent(code)}`, { headers: cronHeaders() })
  if (!catRes.ok) return null
  const cat = await catRes.json()
  if (!cat?.auctionId) return null

  // An AI Upgrade run keeps its progress in its own UpgradeLot rows, not in the
  // pipeline's saved state — nothing more to read here.
  if (item.kind === "upgrade") {
    const lots: Lot[] = (cat.lots ?? []).map((l: any) => ({
      id:          l.id,
      label:       l.barcode || l.receiptUniqueId || l.id,
      keyPoints:   l.keyPoints ?? "",
      imageUrls:   l.imageUrls ?? [],
      currentDesc: l.description || "",
      appliedDesc: l.description || "",
    }))
    return { auctionId: cat.auctionId, lots, staleCleared: 0 }
  }

  // ⚠ This read is NOT best-effort. The saved per-lot state is the only record
  // of what has already been described; treating a failure as "nothing done yet"
  // would send every finished lot back through the AI and, on auto-apply,
  // overwrite good descriptions. Throw so the slice retries instead.
  const pipeRes = await fetch(`${base()}/api/auction-ai/pipeline?code=${encodeURIComponent(code)}`, { headers: cronHeaders() })
  if (!pipeRes.ok) throw new Error(`Couldn't read saved progress for ${code} (HTTP ${pipeRes.status}) — not re-running lots blind.`)
  const pipe = await pipeRes.json()
  const saved: Record<string, any> = {}
  for (const sl of (pipe?.run?.lots ?? [])) saved[sl.lotId] = sl

  // ⚠⚠ THE CATALOGUE OVERRULES THE SAVED ROW WHEN THE LOT IS NOW EMPTY.
  //
  // Measured on F113 (Jordan, 2026-09-02: "601 lots described but well over 100 lots have no
  // description"). A browser run described the sale in the morning; at 15:10 he pressed
  // 🧹 Clear Descriptions, which blanked 499 lots; at 16:11 the overnight run picked up the
  // SAME saved run, whose rows still said batch/key points/double check done. `!l.batchStatus`
  // then skipped 249 of them outright — the log even says "601 lots in scope · Batch run —
  // 352 to do" — and 210 lots were still empty in the morning while the report claimed 600
  // applied. `currentDesc` took the saved text over the catalogue's, so every later stage
  // "checked" wording that was no longer on the lot.
  //
  // A saved row that claims a description, against a lot with none, is STALE — the catalogue
  // has been cleared or wiped underneath it. Forget its statuses so the lot runs again.
  //
  // ⚠ Only when the row actually claims TEXT. A "skipped" (the AI refused) or "nothing" (no
  // photos) row has no description by design, and resetting those would send a content-blocked
  // lot back through the AI every single night.
  // ⚠ ANY text the run holds counts, not just `description`. The columns are written by
  // different stages (batch → description + batchDesc, key points → revised, and appliedDesc
  // records the write), so testing one of them would quietly miss the lots whose row was
  // filled in by a different stage.
  const savedTextOf = (s: any) =>
    (s?.revised || s?.description || s?.batchDesc || s?.appliedDesc || "").trim()

  let staleCleared = 0
  let lots: Lot[] = (cat.lots ?? []).map((l: any) => {
    const s = saved[l.id]
    const stale = !!savedTextOf(s) && !(l.description ?? "").trim()
    if (stale) staleCleared++
    return {
      id:          l.id,
      label:       l.barcode || l.receiptUniqueId || l.id,
      keyPoints:   l.keyPoints ?? "",
      imageUrls:   l.imageUrls ?? [],
      currentDesc: stale ? "" : (s?.description || l.description || ""),
      batchStatus: stale ? undefined : (s?.batchStatus ?? undefined),
      kpStatus:    stale ? undefined : (s?.kpStatus ?? undefined),
      dcStatus:    stale ? undefined : (s?.dcStatus ?? undefined),
      appliedDesc: stale ? "" : (s?.appliedDesc || l.description || ""),
    }
  })
  if (item.onlyWithPhotos) lots = lots.filter(l => l.imageUrls.length > 0)
  if (item.skipHasDesc)    lots = lots.filter(l => !(l.currentDesc ?? "").trim())
  return { auctionId: cat.auctionId, lots, staleCleared }
}

async function saveLot(code: string, lotId: string, label: string, fields: Record<string, any>): Promise<void> {
  await fetch(`${base()}/api/auction-ai/pipeline/lot`, {
    method: "POST",
    headers: cronHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({ code, lotId, label, ...fields }),
  }).catch(() => { /* per-lot progress is best-effort; the stage state is the record */ })
}

// ── Retry ───────────────────────────────────────────────────────────────────
// The browser's withRetry, with one addition: it is bounded by the SLICE, not by
// an attempt count. When a wait won't fit in what's left, it throws SliceOver
// carrying that wait, so the sale sleeps exactly as long as it should and the
// next tick resumes on the very same lot. Nothing is ever marked failed.
async function withRetry<T>(
  label: string,
  deadline: Deadline,
  addLog: (m: string) => void,
  fn: (attempt: number) => Promise<T>,
  /** Filled in when this returns null, so the caller can record WHICH failure it was —
   *  a refusal and an empty answer are different things and must not share a status. */
  outcome?: { reason?: "blocked" | "empty"; rateLimited?: boolean },
): Promise<T | null> {
  let attempt = 0
  let lastError = ""
  let recitations = 0
  let empties = 0
  for (;;) {
    if (attempt > 0) {
      const isRL    = lastError.startsWith("RATE_LIMITED:")
      if (isRL && outcome) outcome.rateLimited = true   // feeds quick mode's pacing
      const isRecit = /RECITATION/i.test(lastError)
      const isEmpty = EMPTY_ANSWER.test(lastError)
      const wait    = isRL ? rateLimitWait(attempt) : (isRecit || isEmpty) ? 1500 : otherWait(attempt)
      // ⚠⚠ NEVER sleep in-process for as long as the heartbeat takes to go stale.
      // flush() is the only thing that writes heartbeatAt and it runs once per LOT, so a
      // long sleep here leaves the queue row looking dead: the 30-second tick sees a
      // RUNNING row more than HEARTBEAT_STALE_MS old, reclaims the sale, and TWO SLICES
      // then run it at once — double the Gemini spend and interleaved writes. The rate-limit
      // backoff reaches 240s on the third consecutive 429, which is past the 3-minute
      // window, so this was reachable on any busy sale.
      //
      // Hand the wait to the QUEUE instead. SliceOver carries it into retryAfter and the
      // handler parks the row as QUEUED, so the sale sleeps exactly this long, nothing can
      // mistake it for a crash, and it resumes ON THIS LOT. Waits shorter than the window
      // (12s/24s/30s, the 1.5s RECITATION nudge, and the first two rate-limit backoffs)
      // still happen in-process, so the common case is unchanged.
      if (wait >= HEARTBEAT_STALE_MS || !deadline.fits(wait)) throw new SliceOver(wait)
      addLog(`  ↺ ${label} — ${isRL ? "rate limited, waiting" : "retrying in"} ${Math.round(wait / 1000)}s (attempt ${attempt + 1})`)
      await sleep(wait)
    }
    attempt++
    try {
      return await fn(attempt)
    } catch (e: any) {
      lastError = e?.message ?? String(e)
      // ⚠⚠ AN EMPTY ANSWER IS A FAILURE, NOT A RESULT. The route can return a perfectly
      // successful call that produced no description; this used to sail through as "ok",
      // write the empty string onto the lot and log a tick (179 lots of 601 on F113).
      // Bounded like RECITATION rather than retried for ever: the model alternates on each
      // attempt, so a few tries is a real second chance, while an endlessly empty lot must
      // not hold up the 600 behind it. Reported loudly when it gives up — never silent.
      if (EMPTY_ANSWER.test(lastError)) {
        // Say WHICH of the two it was — "nothing came back" reads as a quiet model, and
        // a leaked search call is a completely different thing to go and look at.
        const what =
          /leaked tool call/i.test(lastError) ? "it wrote out a search, not a description"
          : MALFORMED_CALL.test(lastError)    ? "it fumbled a tool call"
          : "nothing came back"
        if (empties < MAX_EMPTY_RETRIES) {
          empties++
          addLog(`  ↻ ${label} — ${what}, trying the other model (${empties}/${MAX_EMPTY_RETRIES})`)
          continue
        }
        addLog(`  ✗ ${label} — ${what} after ${MAX_EMPTY_RETRIES} tries, skipping`)
        if (outcome) outcome.reason = "empty"
        return null
      }
      if (isBlock(lastError)) {
        // RECITATION is stochastic and model-specific — it often clears on the
        // other model, which the next attempt selects. Everything else (SAFETY
        // and friends) will never pass, so skip the lot now.
        if (/RECITATION/i.test(lastError) && recitations < MAX_RECITATION_RETRIES) {
          recitations++
          addLog(`  ↻ ${label} — RECITATION, trying the other model (${recitations}/${MAX_RECITATION_RETRIES})`)
          continue
        }
        addLog(`  ✗ ${label} — ${blockReasonLabel(lastError)}, skipping`)
        if (outcome) outcome.reason = "blocked"
        return null
      }
      if (deadline.expired) throw new SliceOver(0)
    }
  }
}

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms))

// ── The three stages ────────────────────────────────────────────────────────
async function runStages(
  item: NonNullable<Item>,
  lots: Lot[],
  deadline: Deadline,
  addLog: (m: string) => void,
  flush: (f: Record<string, any>) => Promise<void>,
  stopRequested: () => Promise<boolean>,
  ctx: Ctx,
): Promise<void> {
  const code = item.code.trim().toUpperCase()
  const modelFor = (attempt: number) => (attempt % 2 === 0 && item.fallbackModel) ? item.fallbackModel : item.model

  // Progress is counted over everything the sale still has to do, so the figure
  // on screen means the same thing across ticks.
  //
  // ⚠⚠ A LOT NOT YET DESCRIBED STILL OWES ITS KEY-POINTS AND DOUBLE-CHECK STEPS.
  // This used to require `currentDesc` for the last two lines, which is empty for
  // every lot before the batch stage runs — so at the start of a sale the total
  // was just the lot count, and once batch finished and key points began, `done`
  // overtook it. `tick` pins the total at `Math.max(total, done)`, so the bar sat
  // at 100% with a whole stage still to run: F114 read "712 of 712 done" while
  // Key Points was on 205 of 507 and Double Check had not started (Jordan,
  // 2026-08-28). A lot that batch has not reached yet is counted for all three.
  const outstanding = () =>
    lots.filter(l => !l.batchStatus).length +
    lots.filter(l => !l.kpStatus && l.keyPoints && (l.currentDesc || !l.batchStatus)).length +
    lots.filter(l => !l.dcStatus && (l.currentDesc || !l.batchStatus)).length

  // ⚡ The gap between lots. Fixed at LOT_GAP_MS unless the sale was queued with
  // quick mode, in which case it widens on a refusal and narrows on a clean run.
  // ⚠ ONE pacer for all three stages: the quota is per project, not per stage, so
  // what the batch stage learns about the real limit must carry into the others.
  const fast = (item as any).fastMode === true
  let gap = fast ? FAST_START_MS : LOT_GAP_MS
  let cleanRun = 0
  let widened = false
  /** Called by the stages after each lot — `refused` when Gemini rate limited us. */
  const pace = (refused: boolean) => {
    if (!fast) return
    if (refused) {
      const was = gap
      gap = Math.min(FAST_MAX_MS, Math.max(gap * 2, FAST_START_MS))
      cleanRun = 0
      if (gap !== was) { widened = true; addLog(`  ⏱ rate limited — slowing to ${Math.round(gap / 1000)}s between lots`) }
      return
    }
    if (++cleanRun >= FAST_EASE_AFTER && gap > FAST_MIN_MS) {
      cleanRun = 0
      gap = Math.max(FAST_MIN_MS, Math.round(gap * 0.8))
      addLog(`  ⏱ running clean — ${Math.round(gap / 1000)}s between lots`)
    }
  }
  if (fast) addLog(`⚡ Quick mode — starting at ${FAST_START_MS / 1000}s between lots and finding its own pace`)

  let done = item.done
  let skipped = item.skipped

  // ⚠ RECOMPUTED, not frozen. The old code took `item.total` from the row and kept
  // it for the life of the run, so a total that was wrong at the start stayed
  // wrong all night. Work genuinely appears and disappears as the run goes on — a
  // lot the AI refuses owes no further stages — so the honest figure is what is
  // done plus what is actually left. It can move by a few either way; a bar stuck
  // on 100% with an hour to run cannot.
  const totalNow = () => Math.max(done + outstanding(), done)

  const tick = async (stage: string) => {
    done++
    item.done = done
    item.total = totalNow()
    item.skipped = skipped
    await flush({ stage, done, total: item.total, skipped })
    if (await stopRequested()) throw new SliceOver(0)
  }

  // ── Stage 1: Batch ────────────────────────────────────────────────────────
  if (item.stage === "batch") {
    const toRun = lots.filter(l => !l.batchStatus)
    addLog(`── Batch run — ${toRun.length} to do`)
    for (const lot of toRun) {
      if (deadline.expired) throw new SliceOver(0)

      if (lot.imageUrls.length === 0) {
        lot.batchStatus = "nothing"
        await saveLot(code, lot.id, lot.label, { batchStatus: "nothing" })
        await tick("batch")
        continue
      }

      const outcome: { reason?: "blocked" | "empty"; rateLimited?: boolean } = {}
      const result = await withRetry(lot.label, deadline, addLog, async (attempt) => {
        const fd = new FormData()
        fd.append("presetKey", item.preset)
        fd.append("model", modelFor(attempt))
        fd.append("grounded", item.grounded ? "true" : "false")
        let imgCount = 0
        for (const url of lot.imageUrls.slice(0, 24)) {
          const blob = await fetchPhoto(url)
          if (!blob) continue
          fd.append(`lot_${lot.label}_image_${imgCount}`, blob, url.split("/").pop() || `img_${imgCount}.jpg`)
          imgCount++
        }
        if (imgCount === 0) throw new Error("No images could be fetched")
        if (lot.keyPoints?.trim()) {
          fd.append(`lot_${lot.label}_context`, lot.keyPoints.trim())
          fd.append(`lot_${lot.label}_contextType`, "keyPoints")
        }
        const res  = await fetch(`${base()}/api/auction-ai/batch`, { method: "POST", headers: cronHeaders(), body: fd })
        const json = await res.json()
        if (!res.ok) throw new Error(json.error ?? res.statusText)
        const r = json.results?.[0]
        if (!r || r.status !== "OK") throw new Error(r?.error ?? "No result from Gemini")
        // ⚠ Belt and braces with the route's own check: the status alone used to be the
        // whole test, and an answer with no description passed it.
        if (!String(r.description ?? "").trim()) throw new Error("The model returned no description.")
        return r
      }, outcome)

      if (result) {
        const desc = result.description ?? ""
        const { low, high } = parseEstimate(result.estimate ?? "")
        let applied = false
        if (item.autoApply && desc) {
          try { await applyDescription(lot.id, desc, ctx); applied = true }
          catch (e: any) { addLog(`  ⚠ ${lot.label} — couldn't write to the catalogue: ${e?.message ?? e}`) }
        }
        // The AI estimate has its own fields and never touches the real one, so
        // it is saved whatever the auto-apply setting says.
        if (low > 0 && high > 0) {
          try { await applyEstimate(lot.id, low, high, ctx) }
          catch (e: any) { addLog(`  ⚠ ${lot.label} — couldn't save the AI estimate: ${e?.message ?? e}`) }
        }
        // ⚠ A size that merely disagrees with the manufacturer is NOT a mistake — we measure
        // the item. shouldKeepFlag drops those and keeps everything else. See lib/measurement-check.ts.
        if (result.flag && shouldKeepFlag(result.flag, lot.keyPoints)) {
          try { await updateLotLogged(lot.id, { aiFlagNote: result.flag }, flagCtx(ctx)) } catch { /* advisory — never fail the run for it */ }
        }
        lot.batchStatus = "ok"
        lot.currentDesc = desc
        if (applied) lot.appliedDesc = desc
        await saveLot(code, lot.id, lot.label, {
          batchStatus: "ok", description: desc, batchDesc: desc, estimate: result.estimate ?? "",
          ...(applied ? { appliedDesc: desc } : {}),
        })
        addLog(`  ✓ ${lot.label}`)
      } else {
        // "skipped" = the AI refused it. "empty" = it answered with nothing. Same
        // outcome for the lot, completely different thing to go and look at.
        const status = outcome.reason === "empty" ? "empty" : "skipped"
        lot.batchStatus = status
        skipped++
        await saveLot(code, lot.id, lot.label, { batchStatus: status })
      }
      await tick("batch")
      pace(outcome.rateLimited === true)
      if (!deadline.fits(gap)) throw new SliceOver(0)
      await sleep(gap)
    }
    item.stage = "kpcheck"
    await flush({ stage: "kpcheck" })
    await advanceStage(code, "kpcheck", item)
  }

  // ── Stage 2: Key Points ───────────────────────────────────────────────────
  if (item.stage === "kpcheck") {
    const toRun = lots.filter(l => !l.kpStatus && l.currentDesc && l.keyPoints)
    addLog(`── Key points — ${toRun.length} to do · ${item.kpRelaxed ? "relaxed wording" : "exact wording"}`)
    for (const lot of toRun) {
      if (deadline.expired) throw new SliceOver(0)

      const kpOutcome: { reason?: "blocked" | "empty"; rateLimited?: boolean } = {}
      const result = await withRetry(lot.label, deadline, addLog, async (attempt) => {
        const res  = await fetch(`${base()}/api/auction-ai/key-points-check`, {
          method: "POST", headers: cronHeaders({ "Content-Type": "application/json" }),
          body: JSON.stringify({ label: lot.label, keyPoints: lot.keyPoints, description: lot.currentDesc, model: modelFor(attempt), mode: item.kpRelaxed ? "relaxed" : "strict", presetKey: item.preset }),
        })
        const json = await res.json()
        if (json.error) throw new Error(json.error)
        return json
      }, kpOutcome)

      if (result) {
        const { revised, changed, missing, added, flag } = result
        // The stage tried to change a product code it cannot have seen (it gets no photos).
        // The cataloguer's value was kept by the route; surface the doubt in the Review tab.
        if (flag && shouldKeepFlag(flag, lot.keyPoints)) {
          try { await updateLotLogged(lot.id, { aiFlagNote: flag }, flagCtx(ctx)) } catch { /* advisory — never fail the run for it */ }
          addLog(`  ⚑ ${lot.label} — flagged: ${flag}`)
        }
        let newDesc = lot.currentDesc
        let applied = false
        if (changed && revised) {
          newDesc = revised
          if (item.autoApply) {
            try { await applyDescription(lot.id, revised, ctx); applied = true }
            catch (e: any) { addLog(`  ⚠ ${lot.label} — key points inserted but the write failed: ${e?.message ?? e}`) }
          }
          lot.kpStatus = "fixed"
          lot.currentDesc = newDesc
          if (applied) lot.appliedDesc = newDesc
          addLog(applied ? `  ⚑ ${lot.label} — key points inserted & applied` : `  ⚑ ${lot.label} — key points inserted, held for review`)
        } else {
          lot.kpStatus = "ok"
        }
        const appliedNow = applied ? newDesc : lot.appliedDesc
        await saveLot(code, lot.id, lot.label, {
          kpStatus: lot.kpStatus, kpMissing: missing, kpAdded: added, description: newDesc, revised: newDesc,
          ...(appliedNow ? { appliedDesc: appliedNow } : {}),
        })
      } else {
        lot.kpStatus = "skipped"
        skipped++
        await saveLot(code, lot.id, lot.label, { kpStatus: "skipped" })
      }
      await tick("kpcheck")
      pace(kpOutcome.rateLimited === true)
      if (!deadline.fits(gap)) throw new SliceOver(0)
      await sleep(gap)
    }
    item.stage = "doublecheck"
    await flush({ stage: "doublecheck" })
    await advanceStage(code, "doublecheck", item)
  }

  // ── Stage 3: Double Check ─────────────────────────────────────────────────
  if (item.stage === "doublecheck") {
    const toRun = lots.filter(l => !l.dcStatus && (l.batchStatus === "ok" || l.currentDesc))
    addLog(`── Double check — ${toRun.length} to do`)
    for (const lot of toRun) {
      if (deadline.expired) throw new SliceOver(0)

      // ⚠ NOT a content block — there is simply nothing to double check. Recording this
      // as "skipped" is what put "content blocked by AI" against 179 lots on F113 whose
      // only fault was that the batch stage had produced no description.
      if (lot.imageUrls.length === 0 || !lot.currentDesc) {
        lot.dcStatus = "nothing"
        await saveLot(code, lot.id, lot.label, { dcStatus: "nothing" })
        await tick("doublecheck")
        continue
      }

      const dcOutcome: { reason?: "blocked" | "empty"; rateLimited?: boolean } = {}
      const result = await withRetry(lot.label, deadline, addLog, async (attempt) => {
        const images: { data: string; mimeType: string }[] = []
        for (const url of lot.imageUrls.slice(0, 6)) {
          const blob = await fetchPhoto(url)
          if (!blob) continue
          images.push({ data: Buffer.from(await blob.arrayBuffer()).toString("base64"), mimeType: blob.type || "image/jpeg" })
        }
        const res  = await fetch(`${base()}/api/auction-ai/double-check`, {
          method: "POST", headers: cronHeaders({ "Content-Type": "application/json" }),
          body: JSON.stringify({ label: lot.label, description: lot.currentDesc, images, model: modelFor(attempt), keyPoints: lot.keyPoints, presetKey: item.preset }),
        })
        const json = await res.json()
        if (json.error) throw new Error(json.error)
        return json
      }, dcOutcome)

      if (result) {
        const { verdict, contradictions, unsupported, revised, flag } = result
        // It tried to rewrite a product code the cataloguer recorded. The route kept the
        // cataloguer's; surface the doubt instead of acting on it.
        if (flag && shouldKeepFlag(flag, lot.keyPoints)) {
          try { await updateLotLogged(lot.id, { aiFlagNote: flag }, flagCtx(ctx)) } catch { /* advisory — never fail the run for it */ }
          addLog(`  ⚑ ${lot.label} — flagged: ${flag}`)
        }
        if (verdict === "issues" && revised) {
          let applied = false
          if (item.autoApply) {
            try { await applyDescription(lot.id, revised, ctx); applied = true }
            catch (e: any) { addLog(`  ⚠ ${lot.label} — double-check fix failed to apply: ${e?.message ?? e}`) }
          }
          lot.dcStatus = verdict
          if (applied) { lot.currentDesc = revised; lot.appliedDesc = revised }
          addLog(applied ? `  ⚑ ${lot.label} — cleaned up & applied` : `  ⚑ ${lot.label} — cleaned up, held for review`)
          await saveLot(code, lot.id, lot.label, {
            dcStatus: verdict, contradictions, unsupported, revised,
            ...(applied ? { description: revised, appliedDesc: revised } : {}),
          })
        } else {
          lot.dcStatus = verdict
          await saveLot(code, lot.id, lot.label, { dcStatus: verdict, contradictions, unsupported })
        }
      } else {
        lot.dcStatus = "skipped"
        skipped++
        await saveLot(code, lot.id, lot.label, { dcStatus: "skipped" })
      }
      await tick("doublecheck")
      pace(dcOutcome.rateLimited === true)
      if (!deadline.fits(gap)) throw new SliceOver(0)
      await sleep(gap)
    }
    item.stage = "complete"
    await advanceStage(code, "complete", item)
  }
}

// ── The AI Upgrade run (kind "upgrade") ─────────────────────────────────────
// One stage: every lot with a description goes through /api/auction-ai/upgrade
// with the modes chosen on the queue form. ⚠ NOTHING is written to the
// catalogue here — every rewrite lands in an UpgradeLot row and waits for a
// person to accept it in the morning (Jordan's choice, 2026-08-20). The rows
// double as the resume record: a lot with a row is never re-run, and reading
// them goes through prisma, which throws on failure rather than pretending
// nothing was done (the not-best-effort rule).
async function runUpgradeKind(
  item: NonNullable<Item>,
  allLots: Lot[],
  deadline: Deadline,
  addLog: (m: string) => void,
  flush: (f: Record<string, any>) => Promise<void>,
  stopRequested: () => Promise<boolean>,
): Promise<void> {
  const modes = item.upgradeModes.split(",").map(m => m.trim()).filter(Boolean)
  const modelFor = (attempt: number) => (attempt % 2 === 0 && item.fallbackModel) ? item.fallbackModel : item.model

  const lots = allLots.filter(l => (l.currentDesc ?? "").trim())
  const existing = await prisma.upgradeLot.findMany({
    where: { queueId: item.id },
    select: { lotId: true },
  })
  const doneIds = new Set(existing.map(r => r.lotId))
  const toRun = lots.filter(l => !doneIds.has(l.id))

  let done = doneIds.size
  let skipped = item.skipped
  const total = lots.length
  addLog(`── AI Upgrade — ${toRun.length} of ${total} still to rewrite`)
  await flush({ stage: "upgrade", done, total, skipped })

  const saveRow = async (lot: Lot, fields: { revised: string; status: string }) => {
    await prisma.upgradeLot.upsert({
      where:  { queueId_lotId: { queueId: item.id, lotId: lot.id } },
      create: { queueId: item.id, lotId: lot.id, label: lot.label, original: lot.currentDesc, ...fields },
      update: fields,
    })
  }

  for (const lot of toRun) {
    if (deadline.expired) throw new SliceOver(0)

    const upOutcome: { reason?: "blocked" | "empty"; rateLimited?: boolean } = {}
    const result = await withRetry(lot.label, deadline, addLog, async (attempt) => {
      const res = await fetch(`${base()}/api/auction-ai/upgrade`, {
        method: "POST", headers: cronHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({ description: lot.currentDesc, modes, model: modelFor(attempt), keyPoints: lot.keyPoints }),
      })
      const json = await res.json()
      if (json.error) throw new Error(json.error)
      return json
    }, upOutcome)

    if (result) {
      const revised = String(result.revised ?? "").trim()
      if (revised) {
        await saveRow(lot, { revised, status: "done" })
        addLog(`  ✓ ${lot.label} — rewritten, waiting for review`)
      } else {
        // Same as the tab: an empty result can't be accepted, so it is recorded
        // plainly rather than sitting behind a button with nothing in it.
        await saveRow(lot, { revised: "", status: "empty" })
        addLog(`  ✗ ${lot.label} — model returned an empty result, skipping`)
      }
    } else {
      // withRetry returned null → a content block, or an answer that could never be used
      // (nothing came back, or it wrote out a search instead of a rewrite). ⚠ Record WHICH:
      // labelling an unusable answer "blocked" sends the morning review looking at Gemini's
      // safety filters for something that was never a refusal.
      await saveRow(lot, { revised: "", status: upOutcome.reason === "empty" ? "empty" : "blocked" })
      skipped++
    }

    done++
    item.done = done
    item.total = total
    item.skipped = skipped
    await flush({ stage: "upgrade", done, total, skipped })
    if (await stopRequested()) throw new SliceOver(0)
    if (!deadline.fits(LOT_GAP_MS)) throw new SliceOver(0)
    await sleep(LOT_GAP_MS)
  }
}

async function advanceStage(code: string, stage: string, item: NonNullable<Item>): Promise<void> {
  await fetch(`${base()}/api/auction-ai/pipeline`, {
    method: "POST", headers: cronHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({ code, stage, model: item.model, preset: item.preset }),
  }).catch(() => { /* the queue row is the record of where we are */ })
}

/** One lot photo, through the same proxy the browser uses. Returns null when it
 *  can't be read, so one bad photo never stops a lot. */
async function fetchPhoto(key: string): Promise<Blob | null> {
  try {
    const r = await fetch(`${base()}/api/catalogue/photo-proxy?key=${encodeURIComponent(key)}`, { headers: cronHeaders() })
    if (!r.ok) return null
    return await r.blob()
  } catch {
    return null
  }
}
