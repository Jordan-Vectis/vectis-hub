import type { WarehouseRole } from "@/lib/apps"
import type { ContainerKind, LocationKind } from "@/lib/goods-in/model"

// The handheld scanner's contract with the Hub — the /scan screen (and the Vectis Scanner app that
// wraps it) on one side, app/api/goods-in/scan/{sync,bootstrap,lookup} on the other. Pure: types
// and constants only, safe in the browser and on the server.
//
//   POST /api/goods-in/scan/sync       { deviceId, events: ScanEvent[] } → SyncResponse
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
