import type { WarehouseRole } from "@/lib/apps"
import type { ContainerKind, LocationKind } from "@/lib/goods-in/model"

// The handheld scanner's contract with the Hub — the /scan screen (and the Vectis Scanner app that
// wraps it) on one side, app/api/goods-in/scan/{sync,acks,bootstrap,lookup} on the other. Pure: types
// and constants only, safe in the browser and on the server.
//
//   POST /api/goods-in/scan/sync       { deviceId, events: ScanEvent[] } → SyncResponse
//   POST /api/goods-in/scan/acks       { deviceId, acks: ScanAck[] } → ScanAckResponse (failed scans acknowledged on the pop-up)
//   GET  /api/goods-in/scan/bootstrap  → BootstrapResponse (cache it: it recognises location codes offline)
//   GET  /api/goods-in/scan/lookup?code=X → LookupResponse (online only)
//
// Errors are always JSON { error } (with ok: false): 401 not signed in, 403 no Warehouse access,
// 400 a request the Hub couldn't read (nothing applied), 503 SCANNER_NOT_SET_UP (nothing applied —
// keep the queue), 500 anything else.

/** Most scans one sync call takes. More is refused (400) with nothing applied. */
export const MAX_SCAN_EVENTS = 200
/** A scan older than this is refused as too old (recorded, never retried). */
export const MAX_SCAN_AGE_DAYS = 7
/** The longest note a scan carries; longer is cut. */
export const MAX_SCAN_NOTE = 500

/** The 503 the sync answers before Run Migrations has made GoodsInScanEvent. Nothing is applied. */
export const SCANNER_NOT_SET_UP = "Goods In scanner isn't set up — an admin needs to press Run Migrations."

/**
 * The ONE refusal the sync doesn't record: a scan made by someone other than whoever is sending it.
 * The screen keeps such a scan waiting (it applies once that person signs in and sends it), and
 * recognises this refusal by exactly this message — shared here so the two sides can't drift.
 */
export const SCANNED_BY_SOMEONE_ELSE = "Scanned by someone else — sign in as them to send it."

export type ScanAction = "move"

export type ScanEvent = {
  /** A uuid made on the scanner, unique per scan — sending it again never applies it twice. */
  id: string
  /** Put an item at a location (put away / to a bench / shelve a lot / check-and-fix). */
  action: ScanAction
  /** Tote/pallet number or lot barcode, as scanned. */
  item: string
  /** Location code, as scanned. */
  location: string
  /** ISO, the device's clock when it was scanned. A future time is taken as now. */
  scannedAt: string
  /** The user id signed in when it was scanned — must be whoever sends it. */
  scannedBy: string
  note?: string | null
}

export type SyncRequest = { deviceId: string; events: ScanEvent[] }

/**
 * - applied: done now.
 * - already: this id was applied before (a replay) — `message` is what was said then.
 * - refused: can't be done (unknown item/location, switched off, already there, too old…), in plain
 *   words. Recorded, so sending it again answers the same — EXCEPT "scanned by someone else", which
 *   isn't recorded: signing in as that person and sending it again applies it.
 * - stale: the item has a newer recorded move than this scan (someone moved it since) — not applied;
 *   `message` says who moved it, where and when. Recorded like a refusal.
 * A replay of a scan that was refused or stale answers "refused" / "stale" again with its message.
 */
export type ScanOutcome = "applied" | "already" | "refused" | "stale"

export type ScanResult = {
  id: string
  outcome: ScanOutcome
  message: string
  /** The item as the Hub has it (a lot's barcode in its own case), when known. */
  item?: string
  /** The location code, normalised, when known. */
  location?: string
  /** The location's kind — on an applied move. */
  kind?: LocationKind
}

/**
 * 200. One result per event that was PROCESSED, in the order sent. ⚠ An event with no result here
 * wasn't processed (the call ran out of time, or the database stopped answering part-way —
 * `error` then says why) — keep it queued and send it again; `unsent` counts them.
 */
export type SyncResponse = { results: ScanResult[]; serverTime: string; unsent?: number; error?: string }

// ─── Failed scans acknowledged on the pop-up (2026-10-21) ────────────────────────────────────
//
// Jack: a scan that fails must be acknowledged before scanning carries on, and the acknowledgement
// is kept in Goods In → Reports per person. The screen queues ONE ScanAck per failure listed on the
// pop-up when "I've seen it — carry on" is pressed (in the same device store as the scans) and sends
// them to POST /api/goods-in/scan/acks. Stored in GoodsInScanAck, once per id — a replay stores
// nothing new and answers ok again. 503 SCANNER_NOT_SET_UP (before Run Migrations has made the
// table) stores NOTHING — keep every acknowledgement queued. Same errors as the sync otherwise.

/** Most acknowledgements one call takes. More is refused (400) with nothing stored. */
export const MAX_SCAN_ACKS = 200
/** The longest barcode an acknowledgement keeps (longer is cut). */
export const MAX_ACK_CODE = 64
/** The longest "what went wrong" an acknowledgement keeps (longer is cut). */
export const MAX_ACK_REASON = 500
/** An acknowledgement made longer ago than this is refused (not stored — drop it). Any other time older than this is taken as unknown. */
export const MAX_ACK_AGE_DAYS = 30

/**
 * What went wrong with the scan the pop-up showed:
 * - refused: the Hub answered "refused" (from the sync — possibly minutes later, after being offline).
 * - stale:   the Hub answered "stale" — someone else had moved the item since it was scanned.
 * - error:   the screen itself showed it as a failure (a red result) — it never reached the Hub as a move.
 * - blocked: scanned while the pop-up was already open, so it wasn't acted on at all.
 */
export const SCAN_ACK_PROBLEMS = ["refused", "stale", "error", "blocked"] as const
export type ScanAckProblem = (typeof SCAN_ACK_PROBLEMS)[number]

/** Each problem in plain words — the pop-up and the Reports pages say the same thing. */
export const SCAN_ACK_PROBLEM_WORDS: Record<ScanAckProblem, string> = {
  refused: "Refused by the Hub",
  stale: "Overtaken — someone had moved it since",
  error: "Didn't go through",
  blocked: "Not taken — the pop-up was open",
}

/**
 * The ONE refusal an acknowledgement is kept for (`keep: true`): it was made by someone other than
 * whoever is sending it. Keep it queued — it is stored once that person signs in on this scanner and
 * it is sent again. (Switch user sends the person's waiting acknowledgements first when online, but
 * never waits on them; it is held only while a failure is still on the pop-up.)
 */
export const ACKED_BY_SOMEONE_ELSE = "Acknowledged by someone else — sign in as them to send it."

export type ScanAck = {
  /** A uuid made on the scanner, one per failure acknowledged — sending it again never stores it twice. */
  id: string
  /** The barcode as scanned (null when there wasn't one). ⚠ Never a sign-in card's code — the Hub drops one if sent. */
  code: string | null
  problem: ScanAckProblem
  /** What went wrong, in the plain words the pop-up showed (the Hub's message for refused / stale). */
  reason: string | null
  /** The scan's own id (ScanEvent.id), when it was a queued scan. */
  scanId?: string | null
  /** ISO, when it was scanned (device clock, corrected as the scans' are). */
  scannedAt?: string | null
  /** ISO, when the pop-up first showed this failure. */
  shownAt: string
  /** ISO, when "I've seen it — carry on" was pressed. */
  acknowledgedAt: string
  /** The user id signed in when it was acknowledged — must be whoever sends it. */
  scannedBy: string
}

export type ScanAckRequest = { deviceId: string; acks: ScanAck[] }

/**
 * - ok: stored now, or stored before (a replay — or the same failed scan already acknowledged under
 *   another id: one row per scan and problem) — take it off the queue.
 * - ok false, keep true: ACKED_BY_SOMEONE_ELSE — keep it queued; it is stored once that person sends it.
 * - ok false, no keep: it can never be stored (no proper id, an unknown problem, no proper time, too
 *   old) and would be refused the same way every time — take it off the queue. `error` says why.
 */
export type ScanAckResult = { id: string; ok: boolean; error?: string; keep?: boolean }

/**
 * 200. One result per acknowledgement PROCESSED, in the order sent. ⚠ One with no result here wasn't
 * processed (the call ran out of time, or the database stopped answering part-way — `error` says
 * why) — keep it queued and send it again; `unsent` counts them.
 */
export type ScanAckResponse = { results: ScanAckResult[]; serverTime: string; unsent?: number; error?: string }

export type ScanLocation = { code: string; name: string | null; kind: LocationKind; active: boolean }

export type BootstrapResponse = {
  user: { id: string; name: string | null; tier: WarehouseRole }
  /** Which Hub this is: "production", "staging", "sandbox"… or "development". */
  hub: string
  locations: ScanLocation[]
  serverTime: string
  /** False until Run Migrations has made the scanner's table — the sync answers 503 till then. */
  ready: boolean
  /** Why it isn't ready, in plain words (SCANNER_NOT_SET_UP). */
  notice?: string
}

/** lookupCode's ScanHit (lib/actions/goods-in.ts) as JSON — a receipt's createdAt is an ISO string. */
export type ScanHitJson =
  | { type: "container"; id: string; kind: ContainerKind; receiptId: string; customer: string; category: string | null; description: string | null; status: string | null; locationCode: string | null }
  | { type: "lot"; lotId: string; barcode: string; title: string; auction: string | null; tote: string | null; receipt: string | null; locationCode: string | null }
  | { type: "receipt"; id: string; customer: string; containers: number; createdAt: string }
  | { type: "location"; code: string; name: string | null; kind: LocationKind }
  | { type: "customer"; id: string; name: string; vendorNo: string | null }

/** Where a tote, pallet or lot is now, and since when. */
export type ScanWhere = {
  code: string
  name: string | null
  /** Null when the code is no longer a location (removed since). */
  kind: LocationKind | null
  active: boolean
  /** ISO — when it was put there (its latest move). */
  since: string | null
  by: string | null
}

/** One thing the Hub records at a location now (goodsAtLocations' row). */
export type ScanHere = {
  type: "tote" | "pallet" | "lot"
  /** Tote/pallet number, or the lot's barcode. */
  code: string
  status: string | null
  receipt: string | null
  customer: string | null
  what: string | null
  sale: string | null
  since: string | null
  by: string | null
}

export type LookupResponse = {
  /** The code as looked up (upper case, spaces removed). */
  code: string
  /** What it is, or null when the Hub doesn't know it. */
  hit: ScanHitJson | null
  /** For a tote, pallet or lot: where it is now (null when it has never been put anywhere). */
  where: ScanWhere | null
  /** For a location: everything the Hub records there now (for Check a location). */
  here?: ScanHere[]
  /** True when `here` was cut short (a very full location). */
  hereTruncated?: boolean
  /** For a receipt: its totes and pallets and where each is. */
  containers?: { id: string; kind: ContainerKind; status: string | null; locationCode: string | null }[]
  serverTime: string
}
