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

export function buildToteMap(totes: BcTote[]): Map<string, BcTote> {
  return new Map(totes.map(t => [norm(t.toteNo), t]))
}

export function checkLot(lot: CheckableLot, toteMap: Map<string, BcTote>): LotToteVerdict {
  const issues: ToteCheckIssue[] = []
  const tote = norm(lot.tote) ? toteMap.get(norm(lot.tote)) : undefined

  if (!norm(lot.tote)) {
    issues.push("no_tote")
  } else if (!tote) {
    issues.push("tote_unknown")
  } else {
    if (norm(tote.receiptNo)) {
      if (!norm(lot.receipt))                             issues.push("receipt_missing")
      else if (norm(lot.receipt) !== norm(tote.receiptNo)) issues.push("receipt_mismatch")
    }
    if (norm(tote.vendorNo)) {
      if (!norm(lot.vendor))                            issues.push("vendor_missing")
      else if (norm(lot.vendor) !== norm(tote.vendorNo)) issues.push("vendor_mismatch")
    }
  }

  // The unique ID carries its receipt as a prefix (R008729-38). If the lot's
  // receipt says otherwise, one of the two is wrong — worth seeing even when
  // the tote itself checks out.
  const uid = (lot.receiptUniqueId ?? "").trim()
  if (uid && norm(lot.receipt)) {
    const base = uid.includes("-") ? uid.slice(0, uid.lastIndexOf("-")) : uid
    if (norm(base) !== norm(lot.receipt)) issues.push("unique_id_mismatch")
  }

  return { issues, tote }
}
