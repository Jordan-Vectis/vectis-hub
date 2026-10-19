import type { LocationKind } from "@/lib/goods-in/model"
import type { ScanEvent, ScanOutcome } from "@/lib/goods-in/scan-contract"

// The handheld scanner (/scan) — the shape a scan is kept in on the device. The shapes sent to and
// from the Hub are the contract, lib/goods-in/scan-contract.ts (shared with the server's routes);
// this adds only what the device keeps beside each scan. Pure types and constants: safe anywhere.

export type {
  BootstrapResponse, LookupResponse, ScanEvent, ScanHere, ScanHitJson, ScanLocation, ScanOutcome, ScanResult, ScanWhere, SyncResponse,
} from "@/lib/goods-in/scan-contract"
export { MAX_SCAN_EVENTS, MAX_SCAN_NOTE, SCANNED_BY_SOMEONE_ELSE, SCANNER_NOT_SET_UP } from "@/lib/goods-in/scan-contract"

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
}

/** How many scans the recent list shows. */
export const RECENT_SHOWN = 20
