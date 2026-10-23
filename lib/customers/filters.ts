// The Customers list's filters, sort and quick views — shared by the server page (which reads the
// URL and runs the queries) and the client list (which writes the URL). Client-safe: no Prisma.

export const TYPES = [
  { key: "all",    label: "Everyone" },
  { key: "seller", label: "Sellers" },
  { key: "buyer",  label: "Buyers" },
  { key: "both",   label: "Seller & buyer" },
  { key: "web",    label: "Website account" },
] as const
export type TypeKey = (typeof TYPES)[number]["key"]

// Tick-box filters. `facet` names the count shown beside the box (null = no count).
export const TOGGLES = [
  { key: "lotsNow",     group: "Activity", label: "Lots in a current sale",       facet: "lotsNow" },
  { key: "receiptYear", group: "Activity", label: "Receipt in the last year",      facet: "receiptYear" },
  { key: "uncollected", group: "Activity", label: "Paid, not collected",           facet: "uncollected", warn: true },
  { key: "notes",       group: "Activity", label: "Has notes or calls",            facet: "notes" },
  { key: "followUp",    group: "Activity", label: "Follow-up due",                 facet: "followUp", warn: true },
  { key: "blocked",     group: "Flags",    label: "Blocked in BC",                 facet: "blocked" },
  { key: "trusted",     group: "Flags",    label: "Trusted buyer",                 facet: "trusted" },
  { key: "noEmail",     group: "Flags",    label: "No email address",              facet: "noEmail" },
] as const
export type ToggleKey = (typeof TOGGLES)[number]["key"]

export const SORTS = [
  { key: "newest",   label: "Newest customer no. first" },
  { key: "name",     label: "Name A–Z" },
  { key: "activity", label: "Most recent note or receipt" },
  { key: "lots",     label: "Most lots" },
  { key: "receipts", label: "Most receipts" },
] as const
export type SortKey = (typeof SORTS)[number]["key"]

export type ListFilters = {
  q: string
  type: TypeKey
  toggles: Record<ToggleKey, boolean>
  sort: SortKey
  page: number
}

/** A change to the filters: any field, and any subset of the tick boxes. */
export type FilterChange = Partial<Omit<ListFilters, "toggles">> & { toggles?: Partial<Record<ToggleKey, boolean>> }

// Built-in quick views (saved views are a later step — these need no table).
export const QUICK_VIEWS: { key: string; label: string; set: FilterChange }[] = [
  { key: "selling-now", label: "Sellers with lots in a current sale", set: { type: "seller", toggles: { lotsNow: true }, sort: "lots" } },
  { key: "chase",       label: "Chase — paid, not collected",         set: { type: "buyer", toggles: { uncollected: true } } },
  { key: "follow-ups",  label: "Follow-ups due",                      set: { toggles: { followUp: true }, sort: "activity" } },
  { key: "recent",      label: "Recent sellers",                      set: { type: "seller", toggles: { receiptYear: true }, sort: "activity" } },
]

export const PAGE_SIZE = 100

const emptyToggles = () => Object.fromEntries(TOGGLES.map(t => [t.key, false])) as Record<ToggleKey, boolean>

export function parseFilters(sp: Record<string, string | string[] | undefined>): ListFilters {
  const one = (k: string) => { const v = sp[k]; return Array.isArray(v) ? v[0] : v }
  const type = TYPES.some(t => t.key === one("type")) ? (one("type") as TypeKey) : "all"
  const sort = SORTS.some(s => s.key === one("sort")) ? (one("sort") as SortKey) : "newest"
  const toggles = emptyToggles()
  for (const t of TOGGLES) if (one(t.key) === "1") toggles[t.key] = true
  return { q: (one("q") ?? "").trim().slice(0, 120), type, toggles, sort, page: Math.max(1, Number(one("page")) || 1) }
}

export function filtersToHref(f: ListFilters, change: FilterChange = {}): string {
  const m: ListFilters = { ...f, ...change, toggles: { ...f.toggles, ...(change.toggles ?? {}) }, page: change.page ?? 1 }
  const u = new URLSearchParams()
  if (m.q) u.set("q", m.q)
  if (m.type !== "all") u.set("type", m.type)
  for (const t of TOGGLES) if (m.toggles[t.key]) u.set(t.key, "1")
  if (m.sort !== "newest") u.set("sort", m.sort)
  if (m.page > 1) u.set("page", String(m.page))
  return `/tools/customers${u.size ? `?${u}` : ""}`
}

export function quickViewHref(view: (typeof QUICK_VIEWS)[number]): string {
  const base: ListFilters = { q: "", type: "all", toggles: emptyToggles(), sort: "newest", page: 1 }
  return filtersToHref(base, view.set)
}

export function activeFilterCount(f: ListFilters): number {
  return (f.type !== "all" ? 1 : 0) + TOGGLES.filter(t => f.toggles[t.key]).length
}

// ── Notes ──
export const NOTE_KINDS = [
  { key: "note",  label: "Note" },
  { key: "call",  label: "Call" },
  { key: "email", label: "Email" },
  { key: "visit", label: "Visit" },
] as const
export type NoteKind = (typeof NOTE_KINDS)[number]["key"]
export const NOTE_MAX = 4000

/** Bank or card details never go in a note (the standing rule): the obvious shapes are refused. */
export function looksLikeBankDetails(text: string): boolean {
  if (/\b(sort\s*code|iban|account\s*(no|number)|card\s*(no|number))\b/i.test(text)) return true
  if (/\b\d{2}[- ]?\d{2}[- ]?\d{2}\b[^\n]{0,30}\b\d{8}\b/.test(text)) return true           // sort code beside an account number
  return /\b(?:\d[ -]?){13,19}\b/.test(text.replace(/\b0\d{9,10}\b/g, ""))                   // a card number (phone numbers taken out first)
}
