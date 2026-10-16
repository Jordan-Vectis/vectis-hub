// Goods In — the shared words and shapes. Pure: safe on the server and in the browser.
//
// The flow (Jack, 2026-10-15): a customer is found or created → their goods are booked onto a
// RECEIPT → grouped by category into TOTES and PALLETS (not item by item) → each stored at a
// location → taken to a BENCH to be catalogued → lots made from it (each with a barcode that
// still ties back to the receipt) → each lot SHELVED until it sells. Nothing here touches
// Business Central.

export type ContainerKind = "tote" | "pallet"
export const CONTAINER_KINDS: { value: ContainerKind; label: string }[] = [
  { value: "tote", label: "Tote" },
  { value: "pallet", label: "Pallet" },
]

/** Where a tote or pallet is in its life. Moves set it; "catalogued" is set by hand once its lots are made. */
export type ContainerStatus = "booked" | "stored" | "bench" | "catalogued" | "returned"
export const CONTAINER_STATUS: Record<ContainerStatus, { label: string; help: string }> = {
  booked: { label: "Booked in", help: "On the receipt, not yet put anywhere." },
  stored: { label: "In storage", help: "Put away at a storage location." },
  bench: { label: "At a bench", help: "With a cataloguer, being made into lots." },
  catalogued: { label: "Catalogued", help: "Its lots have been made." },
  returned: { label: "Returned", help: "Given back to the customer." },
}

export type LocationKind = "storage" | "bench" | "shelf" | "other"
export const LOCATION_KINDS: { value: LocationKind; label: string; help: string }[] = [
  { value: "storage", label: "Storage", help: "Where booked-in totes and pallets wait." },
  { value: "bench", label: "Bench", help: "A cataloguing bench — moving a tote here means it is being catalogued." },
  { value: "shelf", label: "Shelf", help: "Where single lots are kept until they sell." },
  { value: "other", label: "Other", help: "Anything else — a holding area, returns, dispatch." },
]
/** A tote's status after it is moved to a location of this kind. */
export const STATUS_FOR_KIND: Record<LocationKind, ContainerStatus> = { storage: "stored", bench: "bench", shelf: "stored", other: "stored" }

/**
 * A receipt's status. "draft" is a check-in that hasn't been booked in yet: it is saved from the
 * moment the clerk reaches the goods step, so the receipt and every tote and pallet already have
 * their numbers (and their labels can be printed), but NOTHING about it counts as booked in — no
 * count, no "booked in" list, no receipt PDF or email, no Lotting Up / Add Lot fallback — until Book
 * in turns it "open". A thrown-away draft is deleted, or voided when a label was printed or a tote
 * moved (lib/actions/goods-in-checkin.ts). A receipt saved before statuses existed (null) is open.
 */
export type ReceiptStatus = "draft" | "open" | "closed" | "void"
/** The statuses of a receipt that HAS been booked in — what Receipts' close / reopen / void work on. */
export type BookedReceiptStatus = Exclude<ReceiptStatus, "draft">
export const isDraftReceipt = (status: string | null | undefined) => status === "draft"
/** The first words of the note a thrown-away check-in is voided with (labels printed or a tote moved),
 *  so a screen can tell "thrown away before booking in" from a booked receipt a manager voided. */
export const THROWN_AWAY_NOTE = "Thrown away at check-in before booking in"

/**
 * The first words of the line a check-in's notes get when a tote or pallet whose label had been
 * printed is taken off it (removed, or switched between tote and pallet) — its number is gone for
 * good, but the label may still be stuck on something, so the record stays with the receipt:
 * "Taken off this check-in after its label was printed: T026156, T026157 (16 Oct 2026, 10:42, by Jack)."
 * Throwing the check-in away reads these back (labelsGivenUp), so it is voided, not deleted.
 */
export const LABEL_GIVEN_UP_NOTE = "Taken off this check-in after its label was printed"

/** The tote and pallet numbers named on LABEL_GIVEN_UP_NOTE lines in a receipt's notes. */
export function labelsGivenUp(notes: string | null | undefined): string[] {
  const out: string[] = []
  for (const line of (notes ?? "").split(/\r?\n/)) {
    if (!line.startsWith(LABEL_GIVEN_UP_NOTE)) continue
    const list = line.slice(LABEL_GIVEN_UP_NOTE.length).replace(/^:\s*/, "").split(" (")[0]
    for (const part of list.split(/,\s*/)) {
      const id = normaliseCode(part)
      if (/^[A-Z]{1,3}\d{3,9}$/.test(id) && !out.includes(id)) out.push(id)
    }
  }
  return out
}

/** The number series Goods In hands out. */
export type CounterKey = "receipt" | "tote" | "pallet" | "vendor"
export const COUNTERS: Record<CounterKey, { label: string; prefix: string; width: number; example: string }> = {
  receipt: { label: "Receipts", prefix: "R", width: 6, example: "R010244" },
  tote: { label: "Totes", prefix: "T", width: 6, example: "T027657" },
  pallet: { label: "Pallets", prefix: "P", width: 6, example: "P000001" },
  vendor: { label: "Vendor numbers", prefix: "C", width: 6, example: "C227976" },
}
export const COUNTER_KEYS = Object.keys(COUNTERS) as CounterKey[]

export const formatNumber = (prefix: string, n: number, width: number) => `${prefix}${String(n).padStart(width, "0")}`

/** The customer as printed on a receipt — copied onto the receipt at booking so a reprint never changes. */
export type CustomerSnapshot = {
  salutation: string | null
  name: string
  addressLine1: string | null
  addressLine2: string | null
  town: string | null
  county: string | null
  postcode: string | null
  country: string | null
  email: string | null
  mobile: string | null
  phone: string | null
  vatRegNo: string | null
  vendorNo: string | null
  /**
   * The special arrangement on the customer's Fees & agreement tab AS IT WAS WHEN THE RECEIPT WAS
   * BOOKED (GoodsInAgreement.specialArrangement), printed on the receipt under the terms — so a
   * reprint shows what applied on the day. Absent or null = none. (JSON inside
   * GoodsInReceipt.customer, so no schema change; receipts booked before 2026-10-16 don't have it.)
   */
  specialArrangement?: string | null
}

/** A receipt's terms, with the defaults the example receipt carries. */
export type ReceiptTerms = {
  commission: number
  lottingFee: number
  photographyFee: number
  unsoldFee: number
  reservePercent: number
}
export const DEFAULT_TERMS: ReceiptTerms = { commission: 25, lottingFee: 0, photographyFee: 0, unsoldFee: 0, reservePercent: 60 }

/** The longest special arrangement a customer's Fees & agreement tab takes (characters). */
export const SPECIAL_ARRANGEMENT_MAX = 1000

/**
 * A customer's USUAL receipt terms — what Check in starts every receipt with: their own fees
 * (GoodsInCustomer) and their usual reserve (GoodsInAgreement) where set, the standard ones
 * (DEFAULT_TERMS) where not. null / undefined = standard. Pure, so the server and the screens work
 * it out the same way.
 */
export function usualTermsFrom(
  fees: { commission?: number | null; lottingFee?: number | null; photographyFee?: number | null; unsoldFee?: number | null } | null | undefined,
  reservePercent?: number | null,
): ReceiptTerms {
  const pick = (v: number | null | undefined, d: number) => (typeof v === "number" && Number.isFinite(v) ? v : d)
  return {
    commission: pick(fees?.commission, DEFAULT_TERMS.commission),
    lottingFee: pick(fees?.lottingFee, DEFAULT_TERMS.lottingFee),
    photographyFee: pick(fees?.photographyFee, DEFAULT_TERMS.photographyFee),
    unsoldFee: pick(fees?.unsoldFee, DEFAULT_TERMS.unsoldFee),
    reservePercent: pick(reservePercent, DEFAULT_TERMS.reservePercent),
  }
}

/** Location codes and tote/receipt numbers are compared in upper case with spaces removed — scanners and typing both vary. */
export const normaliseCode = (s: string) => s.replace(/\s+/g, "").toUpperCase()

export const isReceiptNo = (s: string) => /^[A-Z]{1,3}\d{4,8}$/.test(normaliseCode(s))
