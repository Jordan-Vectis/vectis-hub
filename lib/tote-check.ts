// Comparing a lot's Vendor / Receipt / Tote against the BC-synced tote data.
//
// ONE source of truth for the rule, shared by:
//   - GET /api/catalogue/tote-check      (the Tote Check tab's report)
//   - autocorrectLotsFromTotes()         (the "match BC" button)
// so the button can never fix something different from what the report shows.
//
// The BC tote table (WarehouseTote: toteNo → receiptNo → vendorNo) is the same
// source the lot wizard's tote box reads, and BC is treated as correct — where
// a lot disagrees, the lot is wrong.

export type ToteCheckIssue =
  | "no_tote"             // nothing to check against
  | "tote_unknown"        // tote isn't in the BC data (typo, or not synced yet)
  | "receipt_mismatch"
  // Receipt disagrees with the TOTE's receipt, but BC's own unique ID backs the lot.
  // The tote is the odd one out, not the receipt - see the note in checkLot.
  | "tote_receipt_mismatch"
  | "receipt_missing"
  | "vendor_mismatch"
  | "vendor_missing"
  | "unique_id_mismatch"  // R008729-38 on a lot whose receipt says something else

export type CheckableLot = {
  id:              string
  barcode:         string | null
  receiptUniqueId: string | null
  title?:          string
  vendor:          string | null
  tote:            string | null
  receipt:         string | null
  createdByName?:  string | null
}

export type BcTote = {
  toteNo:     string
  receiptNo:  string | null
  vendorNo:   string | null
  vendorName: string | null
}

export type LotToteVerdict = {
  issues:  ToteCheckIssue[]
  tote:    BcTote | undefined
  /**
   * EVERY copy of that tote number in BC. ⚠ More than one means the tote number is on
   * several receipts, so "correct the lot from the tote" has no single answer - anything
   * that WRITES must refuse rather than pick one. See buildToteMap.
   */
  copies:  BcTote[]
}

/** Tote / receipt / vendor numbers compare trimmed and case-insensitively —
 *  a hand-typed "t024808" is the same tote as "T024808". */
export const norm = (v: string | null | undefined) => (v ?? "").trim().toLowerCase()

/** Every casing of every tote the lots actually use. Prisma's `in` is
 *  case-sensitive, so querying the raw values alone silently misses rows. */
export function toteLookupVariants(lots: { tote: string | null }[]): string[] {
  const out = new Set<string>()
  for (const l of lots) {
    const t = (l.tote ?? "").trim()
    if (t) { out.add(t); out.add(t.toUpperCase()); out.add(t.toLowerCase()) }
  }
  return [...out]
}

/**
 * ⚠⚠ A TOTE NUMBER IS NOT UNIQUE. Measured on F109 (2026-08-20): C L Parsons had the same
 * tote number on TWO receipts - Jordan, "the customer has duplicated receipts with the same
 * tote number on both, so there may be different receipt numbers even though its the same
 * customer". This used to be `new Map(totes.map(...))`, where a duplicate key silently
 * OVERWRITES: one receipt vanished, and every lot belonging to the losing one was reported
 * as mismatched. Which receipt won depended on row order, so the same data could read
 * differently between syncs.
 *
 * Keep them ALL. A lot is fine if its receipt matches ANY of them.
 */
export function buildToteMap(totes: BcTote[]): Map<string, BcTote[]> {
  const map = new Map<string, BcTote[]>()
  for (const t of totes) {
    const k = norm(t.toteNo)
    const list = map.get(k)
    if (list) list.push(t)
    else map.set(k, [t])
  }
  return map
}

/** The receipt a unique ID carries as its prefix - R006956-77 gives R006956. */
function uidReceipt(uid: string | null | undefined): string {
  const u = (uid ?? "").trim()
  if (!u) return ""
  return u.includes("-") ? u.slice(0, u.lastIndexOf("-")) : u
}

export function checkLot(lot: CheckableLot, toteMap: Map<string, BcTote[]>): LotToteVerdict {
  const issues: ToteCheckIssue[] = []
  const candidates = norm(lot.tote) ? toteMap.get(norm(lot.tote)) ?? [] : []
  // Prefer the copy of the tote whose receipt the lot is actually on - with duplicated
  // receipts sharing a tote number, that is the one this lot came from.
  const tote = candidates.find(t => norm(t.receiptNo) && norm(t.receiptNo) === norm(lot.receipt))
    ?? candidates[0]

  if (!norm(lot.tote)) {
    issues.push("no_tote")
  } else if (!tote) {
    issues.push("tote_unknown")
  } else {
    const receipts = candidates.map(t => norm(t.receiptNo)).filter(Boolean)
    const vendors  = candidates.map(t => norm(t.vendorNo)).filter(Boolean)
    if (receipts.length) {
      if (!norm(lot.receipt)) issues.push("receipt_missing")
      // ⚠ ANY of them. Same tote number on two receipts is real, not corruption.
      else if (!receipts.includes(norm(lot.receipt))) {
        // ⚠⚠ WHICH SIDE IS WRONG? tote.receiptNo is BC's view of the TOTE, not of this
        // LOT, and the two are not the same thing. Measured on F109 (2026-08-20): four lots were
        // reported as "BC says R006447" while BC's own Receipt Lines had them on R006956-77..80,
        // agreeing with the Hub. The tote they were catalogued from is filed under a different
        // receipt, and BC records no tote against those lines at all.
        //
        // The unique ID settles it: BC issues it (BC Match imports BC's own value) and it carries
        // the receipt as a prefix. When that prefix matches the lot's receipt, BC is backing the
        // lot, so the TOTE is the odd one out.
        //
        // ⚠ NOT COSMETIC. receipt_mismatch is what Match BC acts on, and it WRITES the tote's
        // receipt onto the lot - it would have rewritten those four correct lots to R006447, out
        // of step with BC and with their own unique IDs. It is also what puts a lot on BC
        // Corrections, a list telling someone to change a receipt in BC that is already right.
        //
        // ⚠ A legacy Hub-minted uid was DERIVED from lot.receipt, so its prefix always matches
        // and corroborates nothing. Such a lot stops being auto-corrected - chosen deliberately
        // (Jordan, 2026-08-20): nothing is hidden, it still shows as a tote issue, and not
        // auto-writing is the safe side of a check that was about to corrupt correct data.
        const uidBase = uidReceipt(lot.receiptUniqueId)
        issues.push(uidBase && norm(uidBase) === norm(lot.receipt)
          ? "tote_receipt_mismatch"
          : "receipt_mismatch")
      }
    }
    if (vendors.length) {
      if (!norm(lot.vendor)) issues.push("vendor_missing")
      else if (!vendors.includes(norm(lot.vendor))) issues.push("vendor_mismatch")
    }
  }

  // The unique ID carries its receipt as a prefix (R008729-38). If the lot's
  // receipt says otherwise, one of the two is wrong — worth seeing even when
  // the tote itself checks out.
  const uid = (lot.receiptUniqueId ?? "").trim()
  if (uid && norm(lot.receipt)) {
    if (norm(uidReceipt(uid)) !== norm(lot.receipt)) issues.push("unique_id_mismatch")
  }

  return { issues, tote, copies: candidates }
}
