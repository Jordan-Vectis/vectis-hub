import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { Prisma } from "@/app/generated/prisma/client"
import { londonWhen } from "@/lib/goods-in/move-core"
import { CARD_PREFIX } from "@/lib/goods-in/scanner-pass"
import {
  ACKED_BY_SOMEONE_ELSE, MAX_ACK_AGE_DAYS, MAX_ACK_CODE, MAX_ACK_REASON, MAX_SCAN_ACKS, SCAN_ACK_PROBLEMS, SCANNER_NOT_SET_UP,
  type ScanAckProblem, type ScanAckResponse, type ScanAckResult,
} from "@/lib/goods-in/scan-contract"
import { errorJson, failure, isMissingTable } from "../../_lib/shared"
import { scanGate } from "../_lib/scan-gate"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 60

// POST /api/goods-in/scan/acks   { deviceId, acks: ScanAck[] } → { results, serverTime }
//
// The handheld scanner's acknowledgements of failed scans: when a scan fails (refused, overtaken,
// a red result on the screen, or scanned while the pop-up was open), /scan shows a pop-up that must
// be acknowledged before scanning carries on, and queues one record per failure listed on it. They
// arrive here — possibly offline and hours later — and are kept in GoodsInScanAck for Goods In →
// Reports. The contract is lib/goods-in/scan-contract.ts. The gate is the sync's: anyone with
// Warehouse access, the Hub session or a scanner sign-in card (scanGate). Nothing here applies a
// move, changes a scan, or reads or writes Business Central — it only STORES what was acknowledged.
//
//   • ONCE PER ID. Each acknowledgement carries the scanner's own uuid as its id; the insert is
//     createMany({ skipDuplicates: true }), so a retry after a lost answer, or two calls racing,
//     stores it once and both answer ok. And once per QUEUED SCAN: one that names a scanId this
//     person has already acknowledged with the same problem (under another id) answers ok and is
//     not stored, so one refused or overtaken scan is never counted twice in Reports.
//   • scannedBy must be the signed-in user. That refusal is NOT stored and says `keep: true`, so
//     the scanner keeps it and it is stored once that person signs in and sends it (as with scans).
//   • Fields are tidied, never trusted: control characters out, the code cut to MAX_ACK_CODE, the
//     reason to MAX_ACK_REASON, the problem one of SCAN_ACK_PROBLEMS. A time in the future is taken
//     as now; acknowledged more than MAX_ACK_AGE_DAYS ago is refused (not stored — the scanner drops
//     it); any other time older than that is taken as unknown.
//   • ⚠ A sign-in card's code is NEVER stored (RULES: it is never logged, shown or kept) — if one
//     arrives as the code it is dropped, and inside the reason it becomes "a sign-in card".
//   • Not migrated → 503 SCANNER_NOT_SET_UP with NOTHING stored (checked before anything else) —
//     the scanner keeps them queued.
//   • All of a call is stored in ONE insert. Only if that fails because of one record's own DATA
//     (a value the database won't store) are they stored one at a time, so that one is refused
//     rather than holding up the rest; any other fault stores nothing and answers 503 (they're sent
//     again). About 15 seconds in, no new one is started — the rest get no result and stay queued.

const MAX_ID = 100
/** An id: the scanner's uuid — 1 to MAX_ID printable ASCII characters ("!" to "~", no spaces), as the sync's. */
const goodId = (id: string) => id.length <= MAX_ID && /^[!-~]+$/.test(id)
/**
 * Stop starting new one-at-a-time inserts after this, so the answer arrives well inside the screen's
 * 30-second wait (postAcks in lib/goods-in/scan-client/api.ts) — a later answer would be lost there
 * and read as "no Wi-Fi". Change them together.
 */
const TIME_BUDGET_MS = 15_000
const DAY_MS = 86_400_000
/** A time before this is nonsense (a scanner's clock reset, or a value Postgres can't store). */
const EARLIEST = Date.UTC(2020, 0, 1)
const PROBLEMS = new Set<string>(SCAN_ACK_PROBLEMS)
/** One queued scan's failure of one kind — what "the same failed scan" means. */
const scanKey = (scanId: string | null | undefined, problem: string) => `${scanId ?? ""}\u0000${problem}`

const str = (v: unknown) => (typeof v === "string" ? v : "")
/** Control characters a scanner can put round a code (CR, tab, GS1 separators) — never part of one. */
const clean = (v: string) => v.replace(/[\u0000-\u001F\u007F]/g, "")
/** One line of plain words: control characters (newlines included) become spaces, runs of spaces one. */
const oneLine = (v: string) => v.replace(/[\u0000-\u001F\u007F]+/g, " ").replace(/\s{2,}/g, " ").trim()

/** A sign-in card's code, whole or in part, anywhere in a piece of text (case-insensitive: a scanner may send capitals). */
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
const CARD_IN_TEXT = new RegExp(escapeRe(CARD_PREFIX) + "[A-Za-z0-9_-]{8,}", "gi")
const hasCard = (v: string) => v.search(CARD_IN_TEXT) !== -1
const withoutCards = (v: string) => v.replace(CARD_IN_TEXT, "a sign-in card")

/**
 * A fault in ONE record's own data — a value the database won't store — which would fail the same
 * way on every retry. The same test as the sync's (app/api/goods-in/scan/sync/route.ts isDataFault —
 * a route file may export only its handlers, so it can't be shared from there).
 */
function isDataFault(e: unknown): boolean {
  if (e instanceof Prisma.PrismaClientKnownRequestError && /^(P2000|P2003|P2005|P2006|P2007|P2011|P2020)$/.test(e.code)) return true
  const msg = `${(e as { message?: string })?.message ?? ""}`
  return /\b(22001|22003|22007|22008|22021|22P02|23502|23503)\b|invalid byte sequence|value too long|violates foreign key|out of range/i.test(msg)
}

type Row = Prisma.GoodsInScanAckCreateManyInput
type Me = { id: string; name: string | null }
/** One acknowledgement read: either the row to store, or its answer already (a refusal). */
type Read = { id: string; row: Row; result?: undefined } | { id: string; row?: undefined; result: ScanAckResult }

/** A time sent by the scanner: unreadable, before 2020 or older than MAX_ACK_AGE_DAYS → null; in the future → now. */
function saneTime(v: unknown, now: Date): Date | null {
  const s = str(v)
  if (!s) return null
  const t = new Date(s)
  const ms = t.getTime()
  if (!Number.isFinite(ms) || ms < EARLIEST || now.getTime() - ms > MAX_ACK_AGE_DAYS * DAY_MS) return null
  return t > now ? now : t
}

function readAck(me: Me, deviceId: string | null, raw: unknown, now: Date): Read {
  const ev = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {}
  const id = str(ev.id).trim()
  if (!goodId(id)) {
    // Without its id the Hub can't tell a repeat from a new one, so it isn't stored.
    return { id: str(ev.id), result: { id: str(ev.id), ok: false, error: "This acknowledgement has no proper id, so the Hub can't be sure it isn't a repeat — it wasn't stored." } }
  }
  if (str(ev.scannedBy) !== me.id) return { id, result: { id, ok: false, keep: true, error: ACKED_BY_SOMEONE_ELSE } }

  const problem = clean(str(ev.problem)).trim().toLowerCase()
  if (!PROBLEMS.has(problem)) {
    const said = problem.slice(0, 40) || "(none)"
    return { id, result: { id, ok: false, error: `The Hub doesn't know what a "${said}" failed scan is — update the scanner app. It wasn't stored.` } }
  }

  // When it was acknowledged: the one time it can't be stored without.
  const rawAck = str(ev.acknowledgedAt)
  const ackTime = new Date(rawAck)
  if (!rawAck || !Number.isFinite(ackTime.getTime()) || ackTime.getTime() < EARLIEST) {
    return { id, result: { id, ok: false, error: "This acknowledgement has no proper time on it (is the scanner's clock right?) — it wasn't stored." } }
  }
  const acknowledgedAt = ackTime > now ? now : ackTime
  if (now.getTime() - acknowledgedAt.getTime() > MAX_ACK_AGE_DAYS * DAY_MS) {
    return { id, result: { id, ok: false, error: `Acknowledged ${londonWhen(acknowledgedAt)} — more than ${MAX_ACK_AGE_DAYS} days ago, too old to store.` } }
  }
  // The pop-up showed it before (or as) it was acknowledged, and it was scanned before that.
  let shownAt = saneTime(ev.shownAt, now) ?? acknowledgedAt
  if (shownAt > acknowledgedAt) shownAt = acknowledgedAt
  let scannedAt = saneTime(ev.scannedAt, now)
  if (scannedAt && scannedAt > acknowledgedAt) scannedAt = acknowledgedAt

  // ⚠ A sign-in card's code is never stored (nor any part of it).
  const rawCode = clean(str(ev.code)).trim()
  const cardScanned = hasCard(rawCode)
  const code = cardScanned ? null : rawCode.slice(0, MAX_ACK_CODE) || null
  let reason = withoutCards(oneLine(str(ev.reason))).slice(0, MAX_ACK_REASON).trim() || null
  if (cardScanned && !reason) reason = "A sign-in card was scanned."

  const scanId = str(ev.scanId).trim()
  return {
    id,
    row: {
      id, userId: me.id, userName: me.name, deviceId,
      code, problem: problem as ScanAckProblem, reason,
      scanId: scanId && goodId(scanId) ? scanId : null,
      scannedAt, shownAt, acknowledgedAt,
    },
  }
}

export async function POST(req: NextRequest) {
  try {
    const g = await scanGate()
    if (g.res) return g.res
    const me: Me = { id: g.me.id, name: g.me.name?.trim() || null }

    const body = (await req.json().catch(() => null)) as { deviceId?: unknown; acks?: unknown } | null
    if (!body || typeof body !== "object" || !Array.isArray(body.acks)) {
      return errorJson("The scanner sent acknowledgements the Hub couldn't read — nothing was stored.", 400)
    }
    const acks = body.acks as unknown[]
    if (acks.length > MAX_SCAN_ACKS) {
      return errorJson(`That's ${acks.length.toLocaleString("en-GB")} acknowledgements in one go — send at most ${MAX_SCAN_ACKS} at a time. Nothing was stored.`, 400)
    }
    const deviceId = typeof body.deviceId === "string" && clean(body.deviceId).trim() ? clean(body.deviceId).trim().slice(0, MAX_ID) : null
    const noStore = { headers: { "Cache-Control": "no-store" } }
    if (acks.length === 0) return NextResponse.json({ results: [], serverTime: new Date().toISOString() } satisfies ScanAckResponse, noStore)

    const now = new Date()
    const reads = acks.map(raw => readAck(me, deviceId, raw, now))

    // Before anything is stored: is the table there (Run Migrations)? The same read finds the ones
    // in this call that were stored before — those answer ok whoever sends them (as a replayed scan
    // answers its outcome), so the scanner can let them go.
    const ids = [...new Set(reads.map(r => r.id).filter(goodId))]
    let known: Set<string>
    // The queued scans (scanId + problem) this person has acknowledged already, under any id.
    let ackedScans: Set<string>
    try {
      const rows = ids.length
        ? await prisma.goodsInScanAck.findMany({ where: { id: { in: ids } }, select: { id: true } })
        : await prisma.goodsInScanAck.findMany({ take: 1, select: { id: true } })
      known = new Set(ids.length ? rows.map(r => r.id) : [])
      const scanIds = [...new Set(reads.flatMap(r => (r.row?.scanId && !known.has(r.id) ? [r.row.scanId] : [])))]
      const prior = scanIds.length
        ? await prisma.goodsInScanAck.findMany({ where: { userId: me.id, scanId: { in: scanIds } }, select: { scanId: true, problem: true } })
        : []
      ackedScans = new Set(prior.map(p => scanKey(p.scanId, p.problem)))
    } catch (e) {
      if (isMissingTable(e)) return errorJson(SCANNER_NOT_SET_UP, 503)
      throw e
    }

    // The new ones, once each (a copy later in the same call answers as the first). ⚠ ONE row per
    // person, queued scan and problem: the same refused or overtaken scan put on the pop-up twice under
    // two ids (two /scan tabs on one device, or put on again after its first record was sent and
    // pruned) answers ok and stores nothing the second time, so Reports counts that failure once.
    const fresh = new Map<string, Row>()
    const sameScan = new Set<string>()
    for (const r of reads) {
      if (!r.row || known.has(r.id) || fresh.has(r.id)) continue
      if (r.row.scanId) {
        const k = scanKey(r.row.scanId, r.row.problem)
        if (ackedScans.has(k)) { sameScan.add(r.id); continue }
        ackedScans.add(k)
      }
      fresh.set(r.id, r.row)
    }

    const stored = new Set<string>(known)
    const refused = new Map<string, ScanAckResult>()
    let stopped: { reason: unknown } | null = null
    if (fresh.size) {
      try {
        await prisma.goodsInScanAck.createMany({ data: [...fresh.values()], skipDuplicates: true })
        for (const id of fresh.keys()) stored.add(id)
      } catch (e) {
        if (isMissingTable(e)) return errorJson(SCANNER_NOT_SET_UP, 503)
        if (!isDataFault(e)) {
          console.error("goods-in scan acks: couldn't store them:", e)
          return errorJson("The Hub couldn't store the acknowledgements just now — nothing was lost. They'll be sent again.", 503)
        }
        // One record's own data won't go in: store them one at a time so only that one is refused.
        const started = Date.now()
        for (const [id, row] of fresh) {
          if (Date.now() - started > TIME_BUDGET_MS) break
          try {
            await prisma.goodsInScanAck.createMany({ data: [row], skipDuplicates: true })
            stored.add(id)
          } catch (e1) {
            if (isMissingTable(e1) || !isDataFault(e1)) { stopped = { reason: e1 }; break }
            console.error("goods-in scan acks: one couldn't be stored:", id, e1)
            refused.set(id, { id, ok: false, error: "The Hub couldn't store this acknowledgement (something in it the database won't take) — it was dropped." })
          }
        }
      }
    }

    // In the order sent. One with no answer wasn't processed and stays queued on the scanner.
    const results: ScanAckResult[] = []
    let unsent = 0
    for (const r of reads) {
      const done = stored.has(r.id) || sameScan.has(r.id) ? { id: r.id, ok: true } : r.result ?? refused.get(r.id)
      if (done) results.push(done)
      else unsent++
    }
    if (stopped) console.error(`goods-in scan acks stopped with ${unsent} of ${acks.length} not stored:`, stopped.reason)
    const res: ScanAckResponse = {
      results,
      serverTime: new Date().toISOString(),
      ...(unsent ? { unsent } : {}),
      ...(stopped
        ? { error: isMissingTable(stopped.reason) ? SCANNER_NOT_SET_UP : `The Hub stopped with ${unsent} of ${acks.length} acknowledgements not stored — they'll be sent again.` }
        : unsent ? { error: `The Hub ran out of time with ${unsent} of ${acks.length} acknowledgements not stored — they'll be sent again.` } : {}),
    }
    return NextResponse.json(res, noStore)
  } catch (e) {
    if (isMissingTable(e)) return errorJson(SCANNER_NOT_SET_UP, 503)
    return failure("scan acks", e)
  }
}
