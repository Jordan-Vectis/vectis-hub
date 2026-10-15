import type { CustomerRow } from "@/lib/actions/goods-in"
import { DEFAULT_TERMS, type ContainerKind, type ReceiptTerms } from "@/lib/goods-in/model"

// Check in — the shapes and small helpers the steps share. Pure: no hooks, no server code.

/** The categories the counter books goods in under most often. Free text is allowed too. */
export const CATEGORIES = [
  "Star Wars", "Diecast", "Dinky", "Corgi", "Matchbox", "Trains & Model Railway", "Comics", "Action Figures",
  "Action Man", "Barbie", "Dolls", "Teddy Bears", "Lego", "Vinyl & Music", "TV & Film", "Retro Gaming",
  "Trading Cards", "Tinplate", "Militaria", "Sports Memorabilia", "Toy Soldiers", "Model Kits", "General Toys",
]

/** One tote or pallet on the receipt being built. It has no number until it is booked in. */
export type GoodsRow = { key: string; kind: ContainerKind; category: string; description: string }

let seq = 0
export const newKey = () => `row-${++seq}-${Date.now().toString(36)}`
export const blankRow = (kind: ContainerKind): GoodsRow => ({ key: newKey(), kind, category: "", description: "" })
export const isBlankRow = (r: GoodsRow) => !r.category.trim() && !r.description.trim()

/** Most totes and pallets one receipt can hold (createReceipt refuses more). */
export const MAX_ROWS = 200

export function countKinds(rows: { kind: ContainerKind }[]) {
  const totes = rows.filter(r => r.kind === "tote").length
  return { totes, pallets: rows.length - totes }
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

/** "3 totes, 1 pallet" — or "nothing yet". */
export function kindsPhrase(totes: number, pallets: number, joiner: ", " | " and " = ", ") {
  const parts = [totes ? plural(totes, "tote", "totes") : "", pallets ? plural(pallets, "pallet", "pallets") : ""].filter(Boolean)
  return parts.length ? parts.join(joiner) : "nothing yet"
}

// ─── Terms ─────────────────────────────────────────────────────────────────────────────────

/** The terms as typed — strings, so a half-typed "2." doesn't jump about. */
export type TermsDraft = Record<keyof ReceiptTerms, string>

export const TERM_FIELDS: { key: keyof ReceiptTerms; label: string; unit: "%" | "£"; help: string; max: number; whole?: boolean; perCustomer: boolean }[] = [
  { key: "commission", label: "Commission", unit: "%", help: "Of the hammer price.", max: 100, perCustomer: true },
  { key: "lottingFee", label: "Lotting fee", unit: "£", help: "Per lot.", max: 100000, perCustomer: true },
  { key: "photographyFee", label: "Photography", unit: "£", help: "Per lot.", max: 100000, perCustomer: true },
  { key: "unsoldFee", label: "Unsold fee", unit: "£", help: "Per unsold lot.", max: 100000, perCustomer: true },
  { key: "reservePercent", label: "Reserve", unit: "%", help: "Of the bottom estimate.", max: 100, whole: true, perCustomer: false },
]

/** A customer's usual terms, field by field, falling back to the standard terms where they have none. */
export function usualTerms(c: CustomerRow | null): ReceiptTerms {
  return {
    commission: c?.commission ?? DEFAULT_TERMS.commission,
    lottingFee: c?.lottingFee ?? DEFAULT_TERMS.lottingFee,
    photographyFee: c?.photographyFee ?? DEFAULT_TERMS.photographyFee,
    unsoldFee: c?.unsoldFee ?? DEFAULT_TERMS.unsoldFee,
    reservePercent: DEFAULT_TERMS.reservePercent,
  }
}

/** The customer's own value for a term, or null when they use the standard one (reserve is never per customer). */
export function customerTerm(c: CustomerRow | null, key: keyof ReceiptTerms): number | null {
  if (!c || key === "reservePercent") return null
  return c[key] ?? null
}

/** True when what's typed is exactly these terms (an unreadable entry never matches). */
export function sameTerms(d: TermsDraft, t: ReceiptTerms) {
  const p = parseTerms(d).terms
  return !!p && TERM_FIELDS.every(f => p[f.key] === t[f.key])
}

export const termsDraft = (t: ReceiptTerms): TermsDraft => ({
  commission: String(t.commission), lottingFee: String(t.lottingFee), photographyFee: String(t.photographyFee),
  unsoldFee: String(t.unsoldFee), reservePercent: String(t.reservePercent),
})

/** Check what was typed. Fees left blank count as £0; commission and reserve must be filled in. */
export function parseTerms(d: TermsDraft): { terms: ReceiptTerms | null; errors: Partial<Record<keyof ReceiptTerms, string>> } {
  const errors: Partial<Record<keyof ReceiptTerms, string>> = {}
  const out = {} as ReceiptTerms
  for (const f of TERM_FIELDS) {
    const raw = (d[f.key] ?? "").trim().replace(/^£/, "").replace(/%$/, "")
    if (raw === "") {
      if (f.unit === "£") { out[f.key] = 0; continue }
      errors[f.key] = `Fill in the ${f.label.toLowerCase()} (0 if there is none).`
      continue
    }
    const n = Number(raw)
    if (!Number.isFinite(n)) { errors[f.key] = "That isn't a number."; continue }
    if (n < 0) { errors[f.key] = "It can't be less than 0."; continue }
    if (n > f.max) { errors[f.key] = f.unit === "%" ? `It can't be more than ${f.max}%.` : "That looks too big — check it."; continue }
    if (f.whole && !Number.isInteger(n)) { errors[f.key] = "Use a whole number."; continue }
    out[f.key] = f.unit === "£" ? Math.round(n * 100) / 100 : n
  }
  return { terms: Object.keys(errors).length ? null : out, errors }
}

const gbp = new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" })
export const pounds = (n: number) => gbp.format(n)
export const termText = (key: keyof ReceiptTerms, n: number) => {
  const f = TERM_FIELDS.find(t => t.key === key)!
  return f.unit === "£" ? pounds(n) : `${n}%`
}

// ─── Customers ─────────────────────────────────────────────────────────────────────────────

export const fullName = (c: Pick<CustomerRow, "salutation" | "name">) => [c.salutation, c.name].filter(Boolean).join(" ")

export const addressLines = (c: CustomerRow) =>
  [c.addressLine1, c.addressLine2, [c.town, c.county].filter(Boolean).join(", "), c.postcode, c.country]
    .map(s => (s ?? "").trim())
    .filter(Boolean)

export const looksLikeEmail = (s: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.trim())

/** createReceipt's refusal when a number series isn't set — the clerk is sent to Settings. */
export const isNumberingError = (msg: string) => /numbering hasn't been set up|free .* number|Goods In → Settings/i.test(msg)
