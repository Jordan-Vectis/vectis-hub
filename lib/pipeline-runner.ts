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
const MAX_RECITATION_RETRIES = 4

const LOG_MAX = 40_000 // keep the morning report readable and the row small

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

/** Gemini refused this one — it will never succeed on a retry, so the lot is
 *  skipped and reported rather than blocking the sale forever. */
function isBlock(err: string): boolean {
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

async function applyDescription(lotId: string, description: string, ctx: Ctx): Promise<void> {
  await updateLotLogged(lotId, {
    description,
    title: titleFromDescription(description),
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
  return e?.code === "P2021" || /does not exist in the current database/i.test(e?.message ?? "")
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
    const existing = (item.logText ?? "")
    const merged = (existing + (existing ? "\n" : "") + log.join("\n")).slice(-LOG_MAX)
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
    const { lots } = state
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
async function loadLots(item: NonNullable<Item>): Promise<{ auctionId: string; lots: Lot[] } | null> {
  const code = item.code.trim().toUpperCase()
  const catRes = await fetch(`${base()}/api/auction-ai/catalogue-lots?code=${encodeURIComponent(code)}`, { headers: cronHeaders() })
  if (!catRes.ok) return null
  const cat = await catRes.json()
  if (!cat?.auctionId) return null

  // ⚠ This read is NOT best-effort. The saved per-lot state is the only record
  // of what has already been described; treating a failure as "nothing done yet"
  // would send every finished lot back through the AI and, on auto-apply,
  // overwrite good descriptions. Throw so the slice retries instead.
  const pipeRes = await fetch(`${base()}/api/auction-ai/pipeline?code=${encodeURIComponent(code)}`, { headers: cronHeaders() })
  if (!pipeRes.ok) throw new Error(`Couldn't read saved progress for ${code} (HTTP ${pipeRes.status}) — not re-running lots blind.`)
  const pipe = await pipeRes.json()
  const saved: Record<string, any> = {}
  for (const sl of (pipe?.run?.lots ?? [])) saved[sl.lotId] = sl

  let lots: Lot[] = (cat.lots ?? []).map((l: any) => {
    const s = saved[l.id]
    return {
      id:          l.id,
      label:       l.barcode || l.receiptUniqueId || l.id,
      keyPoints:   l.keyPoints ?? "",
      imageUrls:   l.imageUrls ?? [],
      currentDesc: s?.description || l.description || "",
      batchStatus: s?.batchStatus ?? undefined,
      kpStatus:    s?.kpStatus ?? undefined,
      dcStatus:    s?.dcStatus ?? undefined,
      appliedDesc: s?.appliedDesc || l.description || "",
    }
  })
  if (item.onlyWithPhotos) lots = lots.filter(l => l.imageUrls.length > 0)
  if (item.skipHasDesc)    lots = lots.filter(l => !(l.currentDesc ?? "").trim())
  return { auctionId: cat.auctionId, lots }
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
): Promise<T | null> {
  let attempt = 0
  let lastError = ""
  let recitations = 0
  for (;;) {
    if (attempt > 0) {
      const isRL    = lastError.startsWith("RATE_LIMITED:")
      const isRecit = /RECITATION/i.test(lastError)
      const wait    = isRL ? rateLimitWait(attempt) : isRecit ? 1500 : otherWait(attempt)
      if (!deadline.fits(wait)) throw new SliceOver(wait)
      addLog(`  ↺ ${label} — ${isRL ? "rate limited, waiting" : "retrying in"} ${Math.round(wait / 1000)}s (attempt ${attempt + 1})`)
      await sleep(wait)
    }
    attempt++
    try {
      return await fn(attempt)
    } catch (e: any) {
      lastError = e?.message ?? String(e)
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
  const outstanding = () =>
    lots.filter(l => !l.batchStatus).length +
    lots.filter(l => !l.kpStatus && l.currentDesc && l.keyPoints).length +
    lots.filter(l => !l.dcStatus && (l.batchStatus === "ok" || l.currentDesc)).length

  let total = item.total || outstanding() + item.done
  let done = item.done
  let skipped = item.skipped

  const tick = async (stage: string) => {
    done++
    item.done = done
    item.total = Math.max(total, done)
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
        lot.batchStatus = "skipped"
        await saveLot(code, lot.id, lot.label, { batchStatus: "skipped" })
        await tick("batch")
        continue
      }

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
        return r
      })

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
          try { await prisma.catalogueLot.update({ where: { id: lot.id }, data: { aiFlagNote: result.flag } }) } catch { /* advisory */ }
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
        lot.batchStatus = "skipped"
        skipped++
        await saveLot(code, lot.id, lot.label, { batchStatus: "skipped" })
      }
      await tick("batch")
      if (!deadline.fits(LOT_GAP_MS)) throw new SliceOver(0)
      await sleep(LOT_GAP_MS)
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

      const result = await withRetry(lot.label, deadline, addLog, async (attempt) => {
        const res  = await fetch(`${base()}/api/auction-ai/key-points-check`, {
          method: "POST", headers: cronHeaders({ "Content-Type": "application/json" }),
          body: JSON.stringify({ label: lot.label, keyPoints: lot.keyPoints, description: lot.currentDesc, model: modelFor(attempt), mode: item.kpRelaxed ? "relaxed" : "strict", presetKey: item.preset }),
        })
        const json = await res.json()
        if (json.error) throw new Error(json.error)
        return json
      })

      if (result) {
        const { revised, changed, missing, added, flag } = result
        // The stage tried to change a product code it cannot have seen (it gets no photos).
        // The cataloguer's value was kept by the route; surface the doubt in the Review tab.
        if (flag && shouldKeepFlag(flag, lot.keyPoints)) {
          try { await prisma.catalogueLot.update({ where: { id: lot.id }, data: { aiFlagNote: flag } }) } catch { /* advisory */ }
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
      if (!deadline.fits(LOT_GAP_MS)) throw new SliceOver(0)
      await sleep(LOT_GAP_MS)
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

      if (lot.imageUrls.length === 0 || !lot.currentDesc) {
        lot.dcStatus = "skipped"
        await saveLot(code, lot.id, lot.label, { dcStatus: "skipped" })
        await tick("doublecheck")
        continue
      }

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
      })

      if (result) {
        const { verdict, contradictions, unsupported, revised, flag } = result
        // It tried to rewrite a product code the cataloguer recorded. The route kept the
        // cataloguer's; surface the doubt instead of acting on it.
        if (flag && shouldKeepFlag(flag, lot.keyPoints)) {
          try { await prisma.catalogueLot.update({ where: { id: lot.id }, data: { aiFlagNote: flag } }) } catch { /* advisory */ }
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
      if (!deadline.fits(LOT_GAP_MS)) throw new SliceOver(0)
      await sleep(LOT_GAP_MS)
    }
    item.stage = "complete"
    await advanceStage(code, "complete", item)
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
