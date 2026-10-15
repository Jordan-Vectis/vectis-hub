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

export type ReceiptStatus = "open" | "closed" | "void"

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

/** Location codes and tote/receipt numbers are compared in upper case with spaces removed — scanners and typing both vary. */
export const normaliseCode = (s: string) => s.replace(/\s+/g, "").toUpperCase()

export const isReceiptNo = (s: string) => /^[A-Z]{1,3}\d{4,8}$/.test(normaliseCode(s))
