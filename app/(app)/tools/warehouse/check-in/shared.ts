import type { CustomerRow } from "@/lib/actions/goods-in"
import type { CustomerAgreement } from "@/lib/actions/goods-in-agreement"
import type { CheckInRowSaved } from "@/lib/actions/goods-in-checkin"
import { usualTermsFrom, type ContainerKind, type ReceiptTerms } from "@/lib/goods-in/model"

// Check in — the shapes and small helpers the steps share. Pure: no hooks, no server code.

/**
 * The look of a notice on the check-in screens — one shape and padding (the same as ErrorBox and
 * OkBox), three tones. Cards are `box` (rounded-xl); notices are these (rounded-lg).
 */
export const NOTE = {
  info: "rounded-lg border border-indigo-200 dark:border-indigo-800 bg-indigo-50 dark:bg-indigo-950/40 px-4 py-3 text-sm text-indigo-900 dark:text-indigo-100",
  warn: "rounded-lg border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/40 px-4 py-3 text-sm text-amber-900 dark:text-amber-200",
  ok: "rounded-lg border border-emerald-300 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/40 px-4 py-3 text-sm text-emerald-800 dark:text-emerald-200",
  plain: "rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 px-4 py-3 text-sm text-gray-700 dark:text-gray-300",
} as const

/** A small underlined button that reads as a link — still a 44px tap target. */
export const linkBtn = "inline-flex min-h-11 items-center font-semibold text-indigo-700 dark:text-indigo-300 underline underline-offset-2 hover:text-indigo-600 dark:hover:text-indigo-200"

/** The categories the counter books goods in under most often. Free text is allowed too. */
export const CATEGORIES = [
  "Star Wars", "Diecast", "Dinky", "Corgi", "Matchbox", "Trains & Model Railway", "Comics", "Action Figures",
  "Action Man", "Barbie", "Dolls", "Teddy Bears", "Lego", "Vinyl & Music", "TV & Film", "Retro Gaming",
  "Trading Cards", "Tinplate", "Militaria", "Sports Memorabilia", "Toy Soldiers", "Model Kits", "General Toys",
]

/**
 * One tote or pallet on the check-in. `key` is this browser's own id for the row; `id` is its real
 * number once the Hub has given it one (the check-in is saved as a receipt that isn't booked in yet,
 * so a row is numbered as soon as it exists). `idKind` is the kind that number was given for — a
 * tote switched to a pallet keeps showing "Numbering…" until the Hub swaps its number.
 */
export type GoodsRow = {
  key: string
  id: string | null
  idKind: ContainerKind | null
  kind: ContainerKind
  category: string
  description: string
  /** When the label for `id` was printed (ISO), or null. */
  labelPrintedAt: string | null
}

let seq = 0
export const newKey = () => `row-${++seq}-${Date.now().toString(36)}`
export const blankRow = (kind: ContainerKind): GoodsRow => ({ key: newKey(), id: null, idKind: null, kind, category: "", description: "", labelPrintedAt: null })
export const isBlankRow = (r: GoodsRow) => !r.category.trim() && !r.description.trim()

/** The row's number as it stands — null while it hasn't one, or while a kind change is waiting for a new one. */
export const rowNumber = (r: Pick<GoodsRow, "id" | "idKind" | "kind">) => (r.id && r.idKind === r.kind ? r.id : null)
/** True when the label for the row's current number has been printed. */
export const isPrinted = (r: GoodsRow) => !!rowNumber(r) && !!r.labelPrintedAt

/** A row as the Hub saved it (a carried-on check-in) — its number is its key. */
export const rowFromSaved = (r: CheckInRowSaved): GoodsRow => ({
  key: r.id, id: r.id, idKind: r.kind, kind: r.kind, category: r.category ?? "", description: r.description ?? "", labelPrintedAt: r.labelPrintedAt,
})

/**
 * The Hub's answer to a save, merged into the rows on screen by each row's key: only the numbers
 * and label dates come back — never the text, so nothing typed since the save was sent is lost.
 * A row whose number the Hub let go (removed, then brought back with Undo after the save) loses it
 * and is numbered again by the next save.
 */
export function mergeSaved(rs: GoodsRow[], a: { rows: CheckInRowSaved[]; removed: string[] }): GoodsRow[] {
  const byKey = new Map(a.rows.map(r => [r.key, r]))
  const gone = new Set(a.removed)
  return rs.map(r => {
    const s = byKey.get(r.key)
    if (s) {
      const same = s.id === r.id
      const printedAt = same ? (r.labelPrintedAt ?? s.labelPrintedAt) : s.labelPrintedAt
      if (same && r.idKind === s.kind && printedAt === r.labelPrintedAt) return r
      return { ...r, id: s.id, idKind: s.kind, labelPrintedAt: printedAt }
    }
    return r.id && gone.has(r.id) ? { ...r, id: null, idKind: null, labelPrintedAt: null } : r
  })
}

/** A check-in someone left without booking in, offered back on the Customer step (`mine`: the person at the counter started it). */
export type { UnfinishedCheckIn } from "@/lib/actions/goods-in-checkin"

/** What a row's label says about its contents (the labels route prints "category – description"). */
export const labelText = (r: Pick<GoodsRow, "category" | "description">) => [r.category.trim(), r.description.trim()].filter(Boolean).join(" – ")

/** The labels route, for these totes and pallets in this order. */
export const labelsUrl = (ids: string[]) => `/api/goods-in/labels?containers=${ids.map(encodeURIComponent).join(",")}`

/** The one browser tab labels open in — reused, so printing row by row on the iPad doesn't stack up a tab per label. */
export const LABELS_TAB = "gi-labels"

/**
 * Where a row's label stands: not printed, printed, or printed but the row's contents changed since
 * (the label shows "category – description" as it was). `printedAs` is what each row's label said
 * when this screen printed it, by row key.
 */
export function labelState(r: GoodsRow, printedAs: Readonly<Record<string, string>>): "none" | "printed" | "changed" {
  if (!isPrinted(r)) return "none"
  const was = printedAs[r.key]
  return was !== undefined && was !== labelText(r) ? "changed" : "printed"
}

/** The words for a label's state — the same on the goods step and on Check & book in. */
export const LABEL_WORDS = {
  printed: "✓ Printed",
  /** Printed, but what's in it has changed since — the label shows the old words. */
  changed: "Needs reprint",
  none: "Not printed",
} as const

/** "T026156", "T026156 and T026157", "T026156, T026157 and P000003" */
export function listNumbers(ids: string[]) {
  return ids.length <= 1 ? ids.join("") : `${ids.slice(0, -1).join(", ")} and ${ids[ids.length - 1]}`
}

/** Most totes and pallets one receipt can hold (saving the check-in refuses more). */
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

export const TERM_FIELDS: { key: keyof ReceiptTerms; label: string; unit: "%" | "£"; help: string; max: number; whole?: boolean }[] = [
  { key: "commission", label: "Commission", unit: "%", help: "Of the hammer price.", max: 100 },
  { key: "lottingFee", label: "Lotting fee", unit: "£", help: "Per lot.", max: 100000 },
  { key: "photographyFee", label: "Photography", unit: "£", help: "Per lot.", max: 100000 },
  { key: "unsoldFee", label: "Unsold fee", unit: "£", help: "Per unsold lot.", max: 100000 },
  { key: "reservePercent", label: "Reserve", unit: "%", help: "Of the bottom estimate.", max: 100, whole: true },
]

// A customer's standing fees, reserve and any special arrangement are set once, on their customer
// page → Fees & agreement (Jack, 2026-10-16: "Tab on the customer's page"). Check in only uses them.
// The agreement is read on its own (getAgreement) and can be missing — before Run Migrations, or
// while it is still being read — and then the fees on their record and the standard reserve apply.

/** Their Fees & agreement — only when it is this customer's. */
export const agreementOf = (c: Pick<CustomerRow, "id"> | null | undefined, a: CustomerAgreement | null | undefined): CustomerAgreement | null =>
  c && a && a.customerId === c.id ? a : null

type Fee = Exclude<keyof ReceiptTerms, "reservePercent">

/** The customer's own value for a term, or null when they use the standard one. */
export function customerTerm(c: CustomerRow | null, key: keyof ReceiptTerms, a?: CustomerAgreement | null): number | null {
  if (!c) return null
  const own = agreementOf(c, a)
  if (key === "reservePercent") return own?.reservePercent ?? null
  return (own ? own.fees[key as Fee] : c[key as Fee]) ?? null
}

/** A customer's usual terms, field by field, falling back to the standard terms where they have none — worked out exactly as the Hub does (usualTermsFrom). */
export function usualTerms(c: CustomerRow | null, a?: CustomerAgreement | null): ReceiptTerms {
  const own = agreementOf(c, a)
  // The agreement is read after the customer's record, so its fees are the fresher of the two.
  return usualTermsFrom(own ? own.fees : c, own?.reservePercent)
}

/** True when two sets of terms are the same, term by term. */
export const equalTerms = (a: ReceiptTerms, b: ReceiptTerms) => TERM_FIELDS.every(f => a[f.key] === b[f.key])

/** True when what's typed is exactly these terms (an unreadable entry never matches). */
export function sameTerms(d: TermsDraft, t: ReceiptTerms) {
  const p = parseTerms(d).terms
  return !!p && equalTerms(p, t)
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

const FEES = [
  { key: "lottingFee", word: "lotting" },
  { key: "photographyFee", word: "photography" },
  { key: "unsoldFee", word: "unsold" },
] as const

/** The terms as one plain line: "25% commission · no lotting, photography or unsold fees · 60% reserve". */
export function termsLine(t: ReceiptTerms) {
  const charged = FEES.filter(f => t[f.key] > 0).map(f => `${pounds(t[f.key])} ${f.word} fee`)
  const none = FEES.filter(f => !(t[f.key] > 0)).map(f => f.word)
  const noneText = none.length === 0 ? "" : `no ${none.length === 1 ? none[0] : `${none.slice(0, -1).join(", ")} or ${none[none.length - 1]}`} ${none.length === 1 ? "fee" : "fees"}`
  return [`${t.commission}% commission`, ...charged, noneText, `${t.reservePercent}% reserve`].filter(Boolean).join(" · ")
}

// ─── Customers ─────────────────────────────────────────────────────────────────────────────

export const fullName = (c: Pick<CustomerRow, "salutation" | "name">) => [c.salutation, c.name].filter(Boolean).join(" ")

export const addressLines = (c: CustomerRow) =>
  [c.addressLine1, c.addressLine2, [c.town, c.county].filter(Boolean).join(", "), c.postcode, c.country]
    .map(s => (s ?? "").trim())
    .filter(Boolean)

export const looksLikeEmail = (s: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.trim())

/** The Hub's refusal when a number series isn't set (saving a check-in or booking in) — the clerk is sent to Settings. */
export const isNumberingError = (msg: string) => /numbering hasn't been set up|free .* number|Goods In → Settings/i.test(msg)
