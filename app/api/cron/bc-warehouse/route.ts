import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"

export const maxDuration = 300

// POST /api/cron/bc-warehouse           — the twice-daily incremental catch-up
// POST /api/cron/bc-warehouse {full:true} — the 5am FULL walk (see below)
// Protected by CRON_SECRET. Sequence:
// receipt-lines (loop) → auction-lines → changelog → totes → totes-active → totes-all → auction-names
//
// ⚠⚠ WHY A FULL RUN EXISTS AT ALL. The incremental run only asks Business Central for rows it says
// have changed, and BC does not always say. A lot given its number in BC does not get its
// SystemModifiedAt bumped, which is how 94 lots sat with no lot number until a top-up was bolted on.
// A periodic full walk is the only thing that catches that class of gap for good. It runs at 5am,
// an hour after the overnight macro finishes, so the morning's BC Match starts from a complete copy.
//
// ⚠⚠ A FULL RUN MUST THREAD THE PAGE MARKER BACK. The incremental loop below can get away with
// posting an empty body each pass because the route resumes from the last-sync TIMESTAMP, which
// moves forward on its own. A full run has no timestamp — `lastSync` is deliberately null when
// `full` is set — so without passing `nextLink` back every pass would re-fetch page one and the
// loop would spin for ever without finishing. Same trap the tote stages already carry a warning
// about, and the same shape as the vendor-country loop that ran for half an hour placing nothing.

export async function POST(req: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorised" }, { status: 401 })
  }

  let full = false
  try {
    const body = await req.json()
    full = body?.full === true
  } catch { /* no body — incremental */ }

  // ⚠ One at a time. Nothing used to stop the 12-hourly run starting on top of a manual re-sync,
  // which cannot corrupt anything (every write is an upsert) but doubles the load on BC and on the
  // database for no benefit. A run older than three hours is treated as dead rather than blocking
  // for ever on a crashed one.
  const running = await prisma.warehouseSyncLog.findFirst({
    where:   { status: "running", startedAt: { gte: new Date(Date.now() - 3 * 60 * 60 * 1000) } },
    orderBy: { startedAt: "desc" },
    select:  { source: true, startedAt: true },
  })
  if (running) {
    return NextResponse.json({
      ok: false,
      skipped: `A ${running.source} sync started at ${running.startedAt.toISOString()} is still running.`,
    })
  }

  // ⚠⚠ The check above only SAMPLES: each stage writes its own "running" row just while its one
  // request is in flight, so between stages it sees nothing — and on 2026-09-18 the 12-hourly
  // incremental ran on top of the 05:00 FULL, two walks in one 10-connection pool, which is what
  // turned the Status Centre's database light at five in the morning. This lock is taken
  // synchronously and held for the whole walk, so two cron syncs can never overlap in this process.
  const cur = lockBox.__warehouseCronLock
  if (cur && Date.now() - cur.startedAt < LOCK_MAX_AGE_MS) {
    return NextResponse.json({
      ok: false,
      skipped: `The ${cur.full ? "FULL" : "incremental"} cron sync started at ${new Date(cur.startedAt).toISOString()} is still running.`,
    })
  }
  const token = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
  lockBox.__warehouseCronLock = { token, startedAt: Date.now(), full }

  // ⚠⚠ ANSWER AT ONCE and let the walk run on (2026-09-18). A FULL walk takes far longer than
  // Node's 300 s fetch headers timeout, so server.js's wait ended in "FULL error: fetch failed"
  // every single morning while the walk carried on and finished — a false alarm that would have
  // looked identical to a real failure. runSync logs its own result, as it always did.
  void runSync(full, secret)
    .catch(e => console.error(`[cron/bc-warehouse]${full ? " FULL" : ""} failed:`, e))
    .finally(() => { if (lockBox.__warehouseCronLock?.token === token) lockBox.__warehouseCronLock = undefined })
  return NextResponse.json({ ok: true, started: true, full }, { status: 202 })
}

/** A cron walk older than this is treated as dead rather than blocking for ever — the same
 *  three hours the WarehouseSyncLog check above already uses. */
const LOCK_MAX_AGE_MS = 3 * 60 * 60 * 1000
const lockBox = globalThis as unknown as { __warehouseCronLock?: { token: string; startedAt: number; full: boolean } }

async function runSync(full: boolean, secret: string): Promise<void> {
  const base    = `http://localhost:${process.env.PORT ?? 3000}`
  const headers = { "Content-Type": "application/json", Authorization: `Bearer ${secret}` }
  const results: Record<string, any> = {}

  // ── Receipt Lines (loop until more === false) ───────────────────────────────
  // ⚠ On a FULL run the cursor is threaded back (see the warning at the top). On an incremental
  // run it is left null and the route resumes by timestamp, exactly as before.
  let more    = true
  let passes  = 0
  let rcItems = 0
  let rcNext: string | null = null
  while (more && passes < (full ? 600 : 200)) {
    try {
      const res: Response = await fetch(`${base}/api/warehouse/sync/receipt-lines`, {
        method: "POST", headers,
        body: JSON.stringify(full ? { full: true, nextLink: rcNext } : {}),
      })
      const data: any = await res.json().catch(() => ({}))
      if (!res.ok) { results.receiptLines = { error: data.error ?? `HTTP ${res.status}` }; break }
      rcItems += data.itemsProcessed ?? 0
      more   = data.more === true
      rcNext = data.nextLink ?? null
      // A full pass that comes back with "more" but no cursor cannot make progress — stop rather
      // than re-walk page one until the pass limit runs out.
      if (full && more && !rcNext) { results.receiptLines = { items: rcItems, passes, stalled: true }; break }
      passes++
    } catch (e: any) {
      results.receiptLines = { error: e.message }
      break
    }
  }
  if (!results.receiptLines) results.receiptLines = { items: rcItems, passes }

  // ── Auction Lines ───────────────────────────────────────────────────────────
  {
    let mo = true, ps = 0, items = 0
    let nx: string | null = null
    while (mo && ps < (full ? 600 : 1)) {
      try {
        const res: Response = await fetch(`${base}/api/warehouse/sync/auction-lines`, {
          method: "POST", headers,
          body: JSON.stringify(full ? { full: true, nextLink: nx } : {}),
        })
        const data: any = await res.json().catch(() => ({}))
        if (!res.ok) { results.auctionLines = { error: data.error ?? `HTTP ${res.status}` }; break }
        items += data.itemsProcessed ?? 0
        mo = data.more === true
        nx = data.nextLink ?? null
        if (full && mo && !nx) { results.auctionLines = { items, passes: ps, stalled: true }; break }
        ps++
      } catch (e: any) { results.auctionLines = { error: e.message }; break }
    }
    if (!results.auctionLines) results.auctionLines = { items, passes: ps }
  }

  // ── Changelog ───────────────────────────────────────────────────────────────
  {
    let mo = true, ps = 0, items = 0
    let nx: string | null = null
    while (mo && ps < (full ? 600 : 1)) {
      try {
        const res: Response = await fetch(`${base}/api/warehouse/sync/changelog`, {
          method: "POST", headers,
          body: JSON.stringify(full ? { full: true, nextLink: nx } : {}),
        })
        const data: any = await res.json().catch(() => ({}))
        if (!res.ok) { results.changelog = { error: data.error ?? `HTTP ${res.status}` }; break }
        items += data.itemsProcessed ?? 0
        mo = data.more === true
        nx = data.nextLink ?? null
        if (full && mo && !nx) { results.changelog = { items, passes: ps, stalled: true }; break }
        ps++
      } catch (e: any) { results.changelog = { error: e.message }; break }
    }
    if (!results.changelog) results.changelog = { items, passes: ps }
  }

  // ── Totes ───────────────────────────────────────────────────────────────────
  try {
    const res  = await fetch(`${base}/api/warehouse/sync/totes`, { method: "POST", headers, body: JSON.stringify(full ? { full: true } : {}) })
    const data = await res.json().catch(() => ({}))
    results.totes = res.ok ? { items: data.itemsProcessed ?? 0 } : { error: data.error ?? `HTTP ${res.status}` }
  } catch (e: any) { results.totes = { error: e.message } }

  // ── Active Totes (loop until more === false) ────────────────────────────────
  // Unlike receipt-lines (which resumes by timestamp on a bare "{}" call),
  // totes-active pages by cursor — so the nextLink must be threaded back in or
  // every call just re-does the first batch and never reaches the rest. This is
  // what keeps bcCreatedAt (and any future tote column) backfilled overnight
  // rather than needing the manual Data Sync button.
  {
    let taMore   = true
    let taPasses = 0
    let taItems  = 0
    let taNext: string | null = null
    while (taMore && taPasses < 200) {
      try {
        const res: Response = await fetch(`${base}/api/warehouse/sync/totes-active`, {
          method: "POST", headers,
          body:   JSON.stringify({ nextLink: taNext, maxItems: 5000 }),
        })
        const data: any = await res.json().catch(() => ({}))
        if (!res.ok) { results.totesActive = { error: data.error ?? `HTTP ${res.status}` }; break }
        taItems += data.itemsProcessed ?? 0
        taMore   = data.more === true
        taNext   = data.nextLink ?? null
        taPasses++
      } catch (e: any) {
        results.totesActive = { error: e.message }
        break
      }
    }
    if (!results.totesActive) results.totesActive = { items: taItems, passes: taPasses }
  }

  // ── All Receipt Totes (loop until more === false) ───────────────────────────
  // Receipt_Totes_Excel drops totes once ticked Catalogued, so totes-active can
  // never enrich them — totes-all walks the eva/tot custom API (same table, no
  // filter) to keep receipt/vendor/catalogued populated for EVERY tote. Same
  // cursor threading as totes-active: pass nextLink back in each pass.
  {
    let tlMore   = true
    let tlPasses = 0
    let tlItems  = 0
    let tlNext: string | null = null
    while (tlMore && tlPasses < 200) {
      try {
        const res: Response = await fetch(`${base}/api/warehouse/sync/totes-all`, {
          method: "POST", headers,
          body:   JSON.stringify({ nextLink: tlNext, maxItems: 5000 }),
        })
        const data: any = await res.json().catch(() => ({}))
        if (!res.ok) { results.totesAll = { error: data.error ?? `HTTP ${res.status}` }; break }
        tlItems += data.itemsProcessed ?? 0
        tlMore   = data.more === true
        tlNext   = data.nextLink ?? null
        tlPasses++
      } catch (e: any) {
        results.totesAll = { error: e.message }
        break
      }
    }
    if (!results.totesAll) results.totesAll = { items: tlItems, passes: tlPasses }
  }

  // ── Auction Names ───────────────────────────────────────────────────────────
  try {
    const res  = await fetch(`${base}/api/warehouse/sync/auction-names`, { method: "POST", headers })
    const data = await res.json().catch(() => ({}))
    results.auctionNames = res.ok ? { namesWritten: data.namesWritten ?? 0 } : { error: data.error ?? `HTTP ${res.status}` }
  } catch (e: any) { results.auctionNames = { error: e.message } }

  // ── Remove records deleted in BC ────────────────────────────────────────────
  // The stages above are upsert-only, so a row deleted in BC would otherwise live in the
  // cache forever (the R008537 ghosts). Checks suspect receipts against LIVE BC; deletes
  // nothing on an empty or failed answer. See the route for the full safety rules.
  {
    let rdMore = true, rdItems = 0, rdPasses = 0
    let rdNext: string | null = null
    while (rdMore && rdPasses < 100) {
      try {
        const res: Response = await fetch(`${base}/api/warehouse/sync/reconcile-deleted`, {
          method: "POST", headers,
          body:   JSON.stringify({ nextLink: rdNext }),
        })
        const data: any = await res.json().catch(() => ({}))
        if (!res.ok) { results.reconcileDeleted = { error: data.error ?? `HTTP ${res.status}` }; break }
        rdItems += data.itemsProcessed ?? 0
        rdMore   = data.more === true
        rdNext   = data.nextLink ?? null
        rdPasses++
      } catch (e: any) {
        results.reconcileDeleted = { error: e.message }
        break
      }
    }
    if (!results.reconcileDeleted) results.reconcileDeleted = { removed: rdItems, passes: rdPasses }
  }

  console.log(`[cron/bc-warehouse]${full ? " FULL" : ""} finished`, JSON.stringify(results))
}
