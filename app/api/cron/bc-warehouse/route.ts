import { NextRequest, NextResponse } from "next/server"

export const maxDuration = 300

// POST /api/cron/bc-warehouse
// Called by the server's setInterval scheduler to keep warehouse data fresh.
// Protected by CRON_SECRET. Runs a full incremental sync sequence:
// receipt-lines (loop) → auction-lines → changelog → totes → totes-active → totes-all → auction-names

export async function POST(req: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorised" }, { status: 401 })
  }

  const base    = `http://localhost:${process.env.PORT ?? 3000}`
  const headers = { "Content-Type": "application/json", Authorization: `Bearer ${secret}` }
  const results: Record<string, any> = {}

  // ── Receipt Lines (loop until more === false) ───────────────────────────────
  let more    = true
  let passes  = 0
  let rcItems = 0
  while (more && passes < 200) {
    try {
      const res  = await fetch(`${base}/api/warehouse/sync/receipt-lines`, { method: "POST", headers, body: "{}" })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) { results.receiptLines = { error: data.error ?? `HTTP ${res.status}` }; break }
      rcItems += data.itemsProcessed ?? 0
      more = data.more === true
      passes++
    } catch (e: any) {
      results.receiptLines = { error: e.message }
      break
    }
  }
  if (!results.receiptLines) results.receiptLines = { items: rcItems, passes }

  // ── Auction Lines ───────────────────────────────────────────────────────────
  try {
    const res  = await fetch(`${base}/api/warehouse/sync/auction-lines`, { method: "POST", headers, body: "{}" })
    const data = await res.json().catch(() => ({}))
    results.auctionLines = res.ok ? { items: data.itemsProcessed ?? 0 } : { error: data.error ?? `HTTP ${res.status}` }
  } catch (e: any) { results.auctionLines = { error: e.message } }

  // ── Changelog ───────────────────────────────────────────────────────────────
  try {
    const res  = await fetch(`${base}/api/warehouse/sync/changelog`, { method: "POST", headers, body: "{}" })
    const data = await res.json().catch(() => ({}))
    results.changelog = res.ok ? { items: data.itemsProcessed ?? 0 } : { error: data.error ?? `HTTP ${res.status}` }
  } catch (e: any) { results.changelog = { error: e.message } }

  // ── Totes ───────────────────────────────────────────────────────────────────
  try {
    const res  = await fetch(`${base}/api/warehouse/sync/totes`, { method: "POST", headers, body: "{}" })
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

  console.log("[cron/bc-warehouse]", JSON.stringify(results))
  return NextResponse.json({ ok: true, results })
}
