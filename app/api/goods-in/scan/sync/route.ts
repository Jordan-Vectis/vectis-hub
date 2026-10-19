import { NextRequest, NextResponse } from "next/server"
import { revalidatePath } from "next/cache"
import { prisma } from "@/lib/prisma"
import { Prisma } from "@/app/generated/prisma/client"
import { normaliseCode } from "@/lib/goods-in/model"
import { londonWhen, moveItem, type MoveResult, type Mover } from "@/lib/goods-in/move-core"
import {
  MAX_SCAN_AGE_DAYS, MAX_SCAN_EVENTS, MAX_SCAN_NOTE, SCANNED_BY_SOMEONE_ELSE, SCANNER_NOT_SET_UP,
  type ScanResult, type SyncResponse,
} from "@/lib/goods-in/scan-contract"
import { errorJson, failure, isMissingTable } from "../../_lib/shared"
import { scanGate } from "../_lib/scan-gate"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 60

// POST /api/goods-in/scan/sync   { deviceId, events: ScanEvent[] } → { results, serverTime }
//
// The handheld scanner's queue arriving — scans made on /scan (in a browser or the Vectis Scanner
// app), possibly offline and hours ago. The contract is lib/goods-in/scan-contract.ts. Anyone with
// Warehouse access, checked here (proxy.ts leaves /api out of the login gate) — the Hub session, or
// a scanner sign-in card (scanGate). Nothing here reads or writes Business Central.
//
// ⚠⚠ The rules of a move are moveItem (lib/goods-in/move-core.ts) — exactly moveTo's. This route
// only adds the queue's own rules around it:
//   • IDEMPOTENT BY EVENT ID. Each event's outcome is recorded in GoodsInScanEvent IN THE SAME
//     TRANSACTION as its move, and the row is inserted FIRST (ON CONFLICT DO NOTHING), so a second
//     copy of the same scan — a retry after a lost answer, or two sync calls racing — waits for the
//     first, finds the row and answers "already". A scan is applied once or not at all.
//   • In order, one transaction per event, so a later scan of the same tote sees the earlier one.
//   • STALE: a scan whose item has a recorded move newer than its scannedAt (someone moved it since)
//     isn't applied — the message says who, where and when.
//   • scannedBy must be the signed-in user (the ScanUser's id — the Hub login or the card's person). That refusal is NOT recorded, so signing in as them and
//     sending it again still works. (The screen blocks Switch user while scans are waiting.)
//   • scannedAt: a future time is taken as now; older than MAX_SCAN_AGE_DAYS is refused as too old.
//     The move is stamped with the time it was SCANNED, not the time it arrived.
//   • Not migrated → 503 SCANNER_NOT_SET_UP with NOTHING applied (checked before the first event).
//   • Any unexpected error part-way (a lock, a timeout, the connection, a fault in the Hub's own
//     code) stops the call: the events already done are answered, the rest get no result and stay
//     queued on the scanner. Only a fault in one scan's own DATA (a value the database won't store),
//     which would fail the same way for ever, is recorded as a refusal instead, so one bad scan
//     can't hold up everything queued behind it — and a bug can't turn a backlog into refusals.
//   • About 25 seconds in, no new event is started (the rest are sent again on the next call). With
//     one event's worst case on top (5 s waiting for a connection + 10 s running) the answer still
//     arrives inside the screen's 50-second wait (postSync in lib/goods-in/scan-client/api.ts) — a
//     later answer would be lost there and read as "no Wi-Fi". Change them together.

const MAX_ID = 100
/** A scan id: the scanner's uuid — 1 to MAX_ID printable ASCII characters ("!" to "~", no spaces), so it can always be stored and looked up. */
const goodId = (id: string) => id.length <= MAX_ID && /^[!-~]+$/.test(id)
const MAX_CODE = 100
/** Stop starting new events after this, so the answer arrives inside the screen's 50 s wait (see above). */
const TIME_BUDGET_MS = 25_000
/** One event's transaction: at most this long waiting for a connection, and this long running. */
const EVENT_TX = { maxWait: 5_000, timeout: 10_000 } as const
const DAY_MS = 86_400_000
/** A scan time before this is nonsense (a scanner's clock reset, or a value Postgres can't store) — treated as no time. */
const EARLIEST_SCAN = Date.UTC(2020, 0, 1)

type Stored = { id: string; outcome: string; message: string | null; item: string | null; location: string | null }
const STORED_SELECT = { id: true, outcome: true, message: true, item: true, location: true } as const

/** Stop the call here: this scan and the ones after it get no result and stay queued on the scanner. */
class Stop extends Error {
  constructor(readonly reason: unknown) { super("stopped") }
}

const str = (v: unknown) => (typeof v === "string" ? v : "")

/** What a replayed scan answers: "already" for one applied before, else its recorded outcome again. */
function replay(s: Stored): ScanResult {
  const outcome = s.outcome === "applied" ? "already" : s.outcome === "stale" ? "stale" : "refused"
  return {
    id: s.id,
    outcome,
    message: s.message ?? (outcome === "already" ? "This scan was sent before." : "This scan was refused before."),
    ...(s.item ? { item: s.item } : {}),
    ...(s.location ? { location: s.location } : {}),
  }
}

function appliedMessage(m: Extract<MoveResult, { ok: true }>): string {
  const what = m.type === "lot" ? `Lot ${m.item}` : `${m.containerKind === "pallet" ? "Pallet" : "Tote"} ${m.item}`
  const from = m.fromCode ? ` from ${m.fromCode}` : ""
  if (m.type === "container" && m.kind === "bench" && m.status === "bench") return `${what} moved${from} to bench ${m.locationCode} — marked as being catalogued.`
  return `${what} moved${from} to ${m.locationCode}.`
}

/**
 * A fault in THIS scan's own data — a value the database won't store or a reference it won't take —
 * which would fail the same way on every retry. Only these are recorded as refusals; anything else
 * (a lock, a timeout, the connection, or a fault in the Hub's own code) stops the call and the scan
 * stays queued, so a bug can never turn a whole backlog into refusals.
 */
function isDataFault(e: unknown): boolean {
  if (e instanceof Prisma.PrismaClientKnownRequestError && /^(P2000|P2003|P2005|P2006|P2007|P2011|P2020)$/.test(e.code)) return true
  const msg = `${(e as { message?: string })?.message ?? ""}`
  return /\b(22001|22003|22007|22008|22021|22P02|23502|23503)\b|invalid byte sequence|value too long|violates foreign key|out of range/i.test(msg)
}

/** Control characters a scanner can put round a code (CR, tab, GS1 separators) — never part of one. */
const clean = (v: string) => v.replace(/[\u0000-\u001F\u007F]/g, "")

async function readStored(id: string): Promise<Stored | null> {
  return prisma.goodsInScanEvent.findUnique({ where: { id }, select: STORED_SELECT })
}

type Base = { id: string; userId: string; userName: string | null; deviceId: string | null; action: string; item: string | null; location: string | null; scannedAt: Date }

/** Record a final refusal on its own (no move to go with it). A copy recorded first wins. */
async function recordRefusal(base: Base, message: string, extra: Partial<ScanResult> = {}): Promise<ScanResult> {
  const r = await prisma.goodsInScanEvent.createMany({ data: [{ ...base, outcome: "refused", message }], skipDuplicates: true })
  if (r.count === 0) {
    const s = await readStored(base.id)
    if (s) return replay(s)
  }
  return { id: base.id, outcome: "refused", message, ...extra }
}

/**
 * recordRefusal, with the same rule as a move: anything but a fault in this scan's own data stops
 * the call (the scan stays queued). If even the refusal can't be stored because of the scan's data,
 * the refusal is answered unrecorded (and logged) — it would fail the same way on every retry, and
 * one bad scan must not hold up the queue behind it.
 */
async function refuseFinally(base: Base, message: string, extra: Partial<ScanResult>): Promise<ScanResult> {
  try {
    return await recordRefusal(base, message, extra)
  } catch (e) {
    if (isMissingTable(e) || !isDataFault(e)) throw new Stop(e)
    console.error("goods-in scan sync: a refusal couldn't be recorded:", base.id, e)
    return { id: base.id, outcome: "refused", message, ...extra }
  }
}

async function one(me: Mover, deviceId: string | null, raw: unknown, known: Map<string, Stored>, now: Date): Promise<ScanResult> {
  const ev = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {}
  const id = str(ev.id).trim()
  if (!goodId(id)) {
    // Without its id the Hub can't tell a repeat from a new scan, so it isn't recorded or applied.
    return { id: str(ev.id), outcome: "refused", message: "This scan has no proper id, so the Hub can't be sure it isn't a repeat — it wasn't sent. Scan it again." }
  }
  const before = known.get(id)
  if (before) return replay(before)
  if (str(ev.scannedBy) !== me.id) return { id, outcome: "refused", message: SCANNED_BY_SOMEONE_ELSE }

  const action = clean(str(ev.action)).trim().slice(0, 40) || "(none)"
  const item = normaliseCode(clean(str(ev.item))), location = normaliseCode(clean(str(ev.location)))
  const when = new Date(str(ev.scannedAt))
  const validTime = str(ev.scannedAt) !== "" && Number.isFinite(when.getTime()) && when.getTime() >= EARLIEST_SCAN
  const scannedAt = !validTime || when > now ? now : when
  const note = str(ev.note).replace(/\u0000/g, "").trim().slice(0, MAX_SCAN_NOTE) || null
  const base: Base = {
    id, userId: me.id, userName: me.name, deviceId, action,
    item: item ? item.slice(0, 200) : null, location: location ? location.slice(0, 200) : null, scannedAt,
  }
  const codes = { ...(base.item ? { item: base.item } : {}), ...(base.location ? { location: base.location } : {}) }

  // Final refusals before anything is looked at — recorded, so they're never retried for ever.
  if (action !== "move") return refuseFinally(base, `The Hub doesn't know what a "${action}" scan is — update the scanner app, then scan it again.`, codes)
  if (!validTime) return refuseFinally(base, "This scan has no proper time on it (is the scanner's clock right?), so the Hub can't tell whether someone moved the item since — scan it again.", codes)
  if (now.getTime() - scannedAt.getTime() > MAX_SCAN_AGE_DAYS * DAY_MS) {
    return refuseFinally(base, `Scanned ${londonWhen(scannedAt)} — more than ${MAX_SCAN_AGE_DAYS} days ago, too old to send. If it still needs moving, scan it again.`, codes)
  }
  if (!item) return refuseFinally(base, "No tote, pallet or lot was scanned for this move.", codes)
  if (!location) return refuseFinally(base, `No location was scanned for ${item}.`, codes)
  if (item.length > MAX_CODE || location.length > MAX_CODE) return refuseFinally(base, "That code is too long to be a Hub label — scan it again.", codes)

  try {
    const out = await prisma.$transaction(async tx => {
      // Insert first: a second copy of this scan in flight waits here for the first to finish.
      const ins = await tx.goodsInScanEvent.createMany({ data: [{ ...base, outcome: "pending" }], skipDuplicates: true })
      if (ins.count === 0) return null
      const m = await moveItem(tx, me, item, location, { note, at: scannedAt, unlessMovedAfter: scannedAt })
      const res: ScanResult = m.ok
        ? { id, outcome: "applied", message: appliedMessage(m), item: m.item, location: m.locationCode, kind: m.kind }
        : { id, outcome: m.stale ? "stale" : "refused", message: m.error, item: m.item, location: m.locationCode }
      await tx.goodsInScanEvent.update({ where: { id }, data: { outcome: res.outcome, message: res.message, item: res.item ?? base.item, location: res.location ?? base.location } })
      return res
    }, EVENT_TX)
    if (out) return out
    const s = await readStored(id)
    if (s) return replay(s)
    throw new Error("The scan was recorded by another send that then vanished.")
  } catch (e) {
    if (isMissingTable(e) || !isDataFault(e)) throw new Stop(e)
    // A fault in this scan's own data, which would come back on every retry: recorded as refused
    // (and logged), so it can't hold up every scan queued behind it. Nothing of the move was applied
    // — the transaction rolled back.
    console.error("goods-in scan sync: a scan failed:", id, e)
    const msg = String((e as { message?: string })?.message ?? e)
    return refuseFinally(base, `The Hub couldn't make this move (${msg.length < 160 ? msg : "an unexpected error"}) — move it by hand on Scan to move.`, codes)
  }
}

export async function POST(req: NextRequest) {
  try {
    const g = await scanGate()
    if (g.res) return g.res
    const me: Mover = { id: g.me.id, name: g.me.name || null }

    const body = (await req.json().catch(() => null)) as { deviceId?: unknown; events?: unknown } | null
    if (!body || typeof body !== "object" || !Array.isArray(body.events)) {
      return errorJson("The scanner sent something the Hub couldn't read — nothing was saved. Try Send now again.", 400)
    }
    const events = body.events as unknown[]
    if (events.length > MAX_SCAN_EVENTS) {
      return errorJson(`That's ${events.length.toLocaleString("en-GB")} scans in one go — send at most ${MAX_SCAN_EVENTS} at a time. Nothing was saved.`, 400)
    }
    const deviceId = typeof body.deviceId === "string" && clean(body.deviceId).trim() ? clean(body.deviceId).trim().slice(0, MAX_ID) : null
    const noStore = { headers: { "Cache-Control": "no-store" } }
    if (events.length === 0) return NextResponse.json({ results: [], serverTime: new Date().toISOString() } satisfies SyncResponse, noStore)

    // Before anything is applied: is the scanner's table there (Run Migrations)? The same read
    // fetches the scans in this call that were sent before.
    const ids = [...new Set(events.map(e => (e && typeof e === "object" ? str((e as { id?: unknown }).id).trim() : "")).filter(goodId))]
    let known: Map<string, Stored>
    try {
      const rows = ids.length ? await prisma.goodsInScanEvent.findMany({ where: { id: { in: ids } }, select: STORED_SELECT }) : await prisma.goodsInScanEvent.findMany({ take: 1, select: STORED_SELECT })
      known = new Map(ids.length ? rows.map(r => [r.id, r]) : [])
    } catch (e) {
      if (isMissingTable(e)) return errorJson(SCANNER_NOT_SET_UP, 503)
      throw e
    }

    const started = Date.now()
    const results: ScanResult[] = []
    let stopped: { reason: unknown } | null = null
    let applied = 0
    for (const raw of events) {
      if (Date.now() - started > TIME_BUDGET_MS) break
      try {
        const r = await one(me, deviceId, raw, known, new Date())
        results.push(r)
        if (r.outcome === "applied") applied++
      } catch (e) {
        // Anything that escapes one() stops the call rather than failing it: the scans already
        // done keep their answers, and this one and the rest stay queued.
        stopped = { reason: e instanceof Stop ? e.reason : e }
        break
      }
    }
    if (applied) revalidatePath("/tools/warehouse", "layout")

    if (stopped && results.length === 0) {
      if (isMissingTable(stopped.reason)) return errorJson(SCANNER_NOT_SET_UP, 503)
      console.error("goods-in scan sync stopped before the first scan:", stopped.reason)
      return errorJson("The Hub couldn't save the scans just now — nothing was applied. They'll be sent again.", 503)
    }
    if (stopped) console.error(`goods-in scan sync stopped after ${results.length} of ${events.length}:`, stopped.reason)
    const unsent = events.length - results.length
    const res: SyncResponse = {
      results,
      serverTime: new Date().toISOString(),
      ...(unsent ? { unsent } : {}),
      ...(stopped ? { error: isMissingTable(stopped.reason) ? SCANNER_NOT_SET_UP : `The Hub stopped after ${results.length} of ${events.length} scans — the rest will be sent again.` } : {}),
    }
    return NextResponse.json(res, noStore)
  } catch (e) {
    if (isMissingTable(e)) return errorJson(SCANNER_NOT_SET_UP, 503)
    return failure("scan sync", e)
  }
}
