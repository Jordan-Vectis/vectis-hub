// Shared constants + helpers for the Accounts section (monthly bookkeeping
// built from scanned invoices/receipts and manual lines, exported to the
// "April 26"-style spreadsheet).

// The cards / accounts a document can be tagged to. These are now managed in the
// DB (AccountingCardholder) and editable in the UI; this list only seeds the
// initial set (see the run-migrations seed) and is a fallback if none exist.
export const DEFAULT_CARDHOLDERS = ["B Goodall", "J Goodall", "James", "Michael", "Vectis"]

// The "don't know whose card this is" bucket for the Auto match / Unknown option.
// A real, non-empty name (so it passes upload validation and survives saves); docs
// tagged with it sit in their own "Unknown" section until the AI resolves the card
// from the receipt's last-4 digits, or reconciling matches them to a card's statement.
export const UNKNOWN_CARDHOLDER = "Unknown"

export function cleanCardholder(s: string): string {
  return (s ?? "").trim().slice(0, 60)
}

// The last 4 card digits embedded in a managed card name (e.g. "B Goodall 5895" → "5895").
export function cardLast4FromName(name: string): string | null {
  const m = (name ?? "").trim().match(/(\d{4})$/)
  return m ? m[1] : null
}

// Resolve a receipt's card last-4 against the managed card names. Only returns a
// name when EXACTLY ONE card carries those digits — ambiguous digits stay Unknown.
export function resolveCardholderByLast4(last4: string | null | undefined, cardholders: string[]): string | null {
  if (!last4 || !/^\d{4}$/.test(last4)) return null
  const hits = cardholders.filter((n) => cardLast4FromName(n) === last4)
  return hits.length === 1 ? hits[0] : null
}

// VAT codes used on the sheet.
//  1 = standard-rated (20% VAT reclaimable)
//  2 = no / zero-rated VAT
//  7 = personal (not a business cost)
export const VAT_CODES = [
  { code: 1, label: "1 — 20% VAT" },
  { code: 2, label: "2 — No VAT" },
  { code: 7, label: "7 — Personal" },
] as const

// The nominal allocation columns each line's NET value lands in, in the order
// they appear on the spreadsheet. `code` is the nominal account number (blank
// where the sheet doesn't show one).
export const NOMINAL_COLUMNS = [
  { key: "directors",    label: "Directors",     code: "27140" },
  { key: "vectis",       label: "Vectis",        code: "31047" },
  { key: "fares",        label: "Fares",         code: "" },
  { key: "fees",         label: "Fees",          code: "" },
  { key: "otherDebtors", label: "Other Debtors", code: "31042" },
  { key: "fuel",         label: "Fuel",          code: "" },
  { key: "c21050",       label: "21050",         code: "21050" },
  { key: "meals",        label: "Meals",         code: "6020" },
  { key: "computers",    label: "Computers",     code: "31180" },
  { key: "hgfpStor",     label: "HGFP Stor",     code: "18020" },
  { key: "cardFee",      label: "Card Fee",      code: "" },
] as const

export type NominalKey = (typeof NOMINAL_COLUMNS)[number]["key"]
export const NOMINAL_KEYS = NOMINAL_COLUMNS.map((c) => c.key) as string[]

export function columnLabel(key: string): string {
  return NOMINAL_COLUMNS.find((c) => c.key === key)?.label ?? key
}
export function columnCode(key: string): string {
  return NOMINAL_COLUMNS.find((c) => c.key === key)?.code ?? ""
}

// For a standard-rated (code 1) line the gross includes 20% VAT, so VAT = gross/6
// and net = gross - VAT. For codes 2 and 7 there is no reclaimable VAT.
export function vatFromGross(gross: number, vatCode: number): number {
  if (vatCode !== 1) return 0
  return Math.round((gross / 6) * 100) / 100
}
export function netFromGross(gross: number, vat: number): number {
  return Math.round((gross - vat) * 100) / 100
}

// Normalise a supplier/description so "Google Ads", "google ads " and "GOOGLE ADS"
// all map to the same learned rule.
export function normaliseSupplier(s: string): string {
  return s.toLowerCase().replace(/\s+/g, " ").trim()
}

export function isValidColumn(s: string): boolean {
  return NOMINAL_KEYS.includes(s)
}
export function isValidVatCode(n: number): boolean {
  return n === 1 || n === 2 || n === 7
}
