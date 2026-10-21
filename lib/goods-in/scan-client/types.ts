import type { LocationKind } from "@/lib/goods-in/model"
import type { ScanAckProblem, ScanEvent, ScanOutcome } from "@/lib/goods-in/scan-contract"

// The handheld scanner (/scan) — the shape a scan is kept in on the device. The shapes sent to and
// from the Hub are the contract, lib/goods-in/scan-contract.ts (shared with the server's routes);
// this adds only what the device keeps beside each scan. Pure types and constants: safe anywhere.

export type {
  BootstrapResponse, LookupResponse, ScanAck, ScanAckProblem, ScanAckResponse, ScanAckResult, ScanEvent, ScanHere, ScanHitJson, ScanLocation,
  ScanOutcome, ScanResult, ScanWhere, SyncResponse,
} from "@/lib/goods-in/scan-contract"
export {
  ACKED_BY_SOMEONE_ELSE, MAX_ACK_CODE, MAX_ACK_REASON, MAX_SCAN_ACKS, MAX_SCAN_EVENTS, MAX_SCAN_NOTE, SCAN_ACK_PROBLEM_WORDS, SCANNED_BY_SOMEONE_ELSE,
  SCANNER_NOT_SET_UP,
} from "@/lib/goods-in/scan-contract"

/** Where a scan is on this device: waiting to be sent, or what the Hub said about it. */
export type ScanStatus = "waiting" | ScanOutcome

/** A scan as kept on the device (IndexedDB, or localStorage when that isn't available). */
export type StoredScan = ScanEvent & {
  /** Scan order on this device — the queue is sent in this order. */
  seq: number
  /** Who scanned it, for the list (scannedBy is their id). */
  userName: string | null
  status: ScanStatus
  /** What the Hub said (plain words), once it has answered. */
  message: string | null
  /** When the Hub's answer arrived (ISO). */
  doneAt: string | null
  /** The location's kind, on an applied move. */
  kind: LocationKind | null
  /** A refused or stale scan stays on screen until someone presses Dismiss. */
  dismissed: boolean
  /** Which screen made it: Put away / Move, Check a location's "Move it here", or "Move it anyway" after a stale answer. */
  via: "move" | "check" | "anyway"
  /**
   * The failed-scan pop-up's mark (absent on scans from before it existed — never popped up for those):
   * false = a refused or stale answer the pop-up hasn't been given yet (set by sync.ts with the answer),
   * true = given to it (or it wasn't a failure — "already there"). Kept on the scan, so an answer that
   * arrives just as the page closes still reaches the pop-up when it opens again.
   */
  flagged?: boolean
}

/** How many scans the recent list shows. */
export const RECENT_SHOWN = 20

// ── The failed-scan pop-up and its acknowledgements ──────────────────────────────────────────
//
// A scan that fails stops scanning with a pop-up until it is tapped away ("I've seen it — carry
// on"). Each failure shown is kept on the device as an AckRecord — "open" while it is on the pop-up,
// "waiting" once acknowledged, then sent as a ScanAck (the contract) to POST /api/goods-in/scan/acks
// (sync.ts) so Goods In → Reports can say who acknowledged which failed scan, and when.

/** What went wrong: refused, stale, error (a red answer on the screen) or blocked (scanned while the pop-up was open) — the contract's ScanAckProblem. */
export type AckProblem = ScanAckProblem

/** A failed scan as kept on the device: on the pop-up ("open"), then acknowledged and on its way to the Hub. */
export type AckRecord = {
  id: string
  /** Whose scan it was (their user id) — the pop-up shows only the signed-in person's. */
  scannedBy: string
  userName: string | null
  /** The barcode (null for one that can't be shown — a sign-in card, or a scan that broke before it was read). */
  code: string | null
  problem: AckProblem
  /** The pop-up's bold line, in plain words. */
  title: string
  /** The pop-up's detail line. */
  detail: string | null
  /** What is sent to the Hub (and shows in Reports). */
  reason: string | null
  /** The queued scan it was about (refused / stale). */
  scanId: string | null
  /** Where that scan was moving it to. */
  location: string | null
  /** When it was scanned (ISO, the Hub's time). */
  scannedAt: string | null
  /** When the Hub's answer came (refused / stale). */
  answeredAt: string | null
  /** When it went on the pop-up. */
  shownAt: string
  /** When "I've seen it" was tapped; null while still on the pop-up. */
  acknowledgedAt: string | null
  /** open = on the pop-up · waiting = acknowledged, to send · sent = the Hub has it · refused = the Hub wouldn't take it (not sent again). */
  status: "open" | "waiting" | "sent" | "refused"
  /** What the Hub said about a refused one. */
  message: string | null
  /** When the Hub answered for it. */
  doneAt: string | null
  /** Order on this device. */
  seq: number
}
