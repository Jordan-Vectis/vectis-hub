import type { Prisma } from "@/app/generated/prisma/client"
import { CONTAINER_STATUS, LOCATION_KINDS, normaliseCode, type ContainerStatus, type LocationKind } from "@/lib/goods-in/model"
import { FROM_BC, HUB_MADE_CONTAINER } from "@/lib/goods-in/source"

// Goods In → Totes & pallets: the warehouse database, every tote and pallet the Hub holds (its own
// and BC's copied ones), filterable and searchable. The filter lives in the URL so Back and a shared
// link keep it; this module reads it, writes it back, and turns it into the Prisma query — shared by
// the page and the CSV export so the two can never disagree. SERVER ONLY (Prisma types).

export const TOTE_PAGE_SIZE = 100
export const TOTE_EXPORT_MAX = 50_000

export const TOTE_SORTS = ["created", "id", "status", "location", "moved", "receipt", "customer", "category"] as const
export type ToteSort = (typeof TOTE_SORTS)[number]
export const TOTE_SORT_LABEL: Record<ToteSort, string> = {
  created: "Booked", id: "Number", status: "Status", location: "Location", moved: "Last moved", receipt: "Receipt", customer: "Customer", category: "Category",
}

export type ToteFilter = {
  q: string
  kind: "" | "tote" | "pallet"
  status: "" | ContainerStatus
  source: "" | "hub" | "bc"
  /** Location code, or part of one. */
  loc: string
  /** Location kind, or "none" = not put anywhere. */
  lockind: "" | LocationKind | "none"
  receipt: string
  /** Booked between these London days (YYYY-MM-DD), both inclusive. */
  from: string
  to: string
  /** Only ones whose label hasn't been printed. */
  nolabel: boolean
  /** Include totes on voided receipts and check-ins not booked in yet. */
  all: boolean
  sort: ToteSort
  dir: "asc" | "desc"
  page: number
}

export const DEFAULT_TOTE_FILTER: ToteFilter = { q: "", kind: "", status: "", source: "", loc: "", lockind: "", receipt: "", from: "", to: "", nolabel: false, all: false, sort: "created", dir: "desc", page: 1 }

type SP = Record<string, string | string[] | undefined>
const one = (v: string | string[] | undefined) => ((Array.isArray(v) ? v[0] : v) ?? "").trim()
const isYmd = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s)

export function parseToteFilter(sp: SP): ToteFilter {
  const kind = one(sp.kind)
  const status = one(sp.status)
  const source = one(sp.source)
  const lockind = one(sp.lockind)
  const sort = one(sp.sort)
  const dir = one(sp.dir)
  return {
    q: one(sp.q).slice(0, 100),
    kind: kind === "tote" || kind === "pallet" ? kind : "",
    status: status in CONTAINER_STATUS ? (status as ContainerStatus) : "",
    source: source === "hub" || source === "bc" ? source : "",
    loc: normaliseCode(one(sp.loc)).slice(0, 24),
    lockind: lockind === "none" || LOCATION_KINDS.some(k => k.value === lockind) ? (lockind as ToteFilter["lockind"]) : "",
    receipt: normaliseCode(one(sp.receipt)).slice(0, 24),
    from: isYmd(one(sp.from)) ? one(sp.from) : "",
    to: isYmd(one(sp.to)) ? one(sp.to) : "",
    nolabel: one(sp.nolabel) === "1",
    all: one(sp.all) === "1",
    sort: (TOTE_SORTS as readonly string[]).includes(sort) ? (sort as ToteSort) : "created",
    dir: dir === "asc" ? "asc" : dir === "desc" ? "desc" : (TOTE_SORTS as readonly string[]).includes(sort) && sort !== "created" && sort !== "moved" ? "asc" : "desc",
    page: Math.max(1, Math.floor(Number(one(sp.page))) || 1),
  }
}

/** The URL for a filter (page 1 unless asked), with the defaults left out so a plain link stays plain. */
export function toteFilterQuery(f: ToteFilter, over: Partial<ToteFilter> = {}): string {
  const g = { ...f, page: 1, ...over }
  const p = new URLSearchParams()
  if (g.q) p.set("q", g.q)
  if (g.kind) p.set("kind", g.kind)
  if (g.status) p.set("status", g.status)
  if (g.source) p.set("source", g.source)
  if (g.loc) p.set("loc", g.loc)
  if (g.lockind) p.set("lockind", g.lockind)
  if (g.receipt) p.set("receipt", g.receipt)
  if (g.from) p.set("from", g.from)
  if (g.to) p.set("to", g.to)
  if (g.nolabel) p.set("nolabel", "1")
  if (g.all) p.set("all", "1")
  if (g.sort !== "created" || g.dir !== "desc") { p.set("sort", g.sort); p.set("dir", g.dir) }
  if (g.page > 1) p.set("page", String(g.page))
  const s = p.toString()
  return s ? `?${s}` : ""
}

export const toteFilterActive = (f: ToteFilter) =>
  !!(f.q || f.kind || f.status || f.source || f.loc || f.lockind || f.receipt || f.from || f.to || f.nolabel || f.all)

/** Minutes London is ahead of UTC at that instant (0 in winter, 60 in summer). */
function londonOffsetMinutes(at: Date): number {
  const part = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", timeZoneName: "shortOffset" }).formatToParts(at).find(p => p.type === "timeZoneName")?.value ?? "GMT"
  const m = /GMT([+-])(\d{1,2})(?::(\d{2}))?/.exec(part)
  if (!m) return 0
  return (m[1] === "-" ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3] ?? 0))
}
/** Midnight in London at the start of a YYYY-MM-DD day, as a real instant. */
function londonStartOfDay(ymd: string, addDays = 0): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd)
  if (!m) return null
  const utc = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + addDays)
  if (!Number.isFinite(utc)) return null
  return new Date(utc - londonOffsetMinutes(new Date(utc)) * 60_000)
}

/**
 * The Prisma where for a filter. `omit` leaves one facet out — the status / kind / source counts
 * are "what you'd get if you picked this", so each is counted with its own facet cleared.
 */
export function toteWhere(f: ToteFilter, omit?: "status" | "kind" | "source"): Prisma.GoodsInContainerWhereInput {
  const and: Prisma.GoodsInContainerWhereInput[] = []
  const like = (s: string) => ({ contains: s, mode: "insensitive" as const })
  if (f.q) {
    const code = normaliseCode(f.q)
    const or: Prisma.GoodsInContainerWhereInput[] = [
      { id: like(code) }, { receiptId: like(code) }, { category: like(f.q) }, { description: like(f.q) }, { locationCode: like(code) },
      { receipt: { vendorNo: like(code) } },
      { receipt: { person: { OR: [{ name: like(f.q) }, { name2: like(f.q) }, { contactNo: { equals: code, mode: "insensitive" } }] } } },
    ]
    and.push({ OR: or })
  }
  if (f.kind && omit !== "kind") and.push({ kind: f.kind })
  if (f.status && omit !== "status") and.push(f.status === "booked" ? { OR: [{ status: null }, { status: "booked" }] } : { status: f.status })
  if (f.source && omit !== "source") and.push(f.source === "bc" ? { source: FROM_BC } : HUB_MADE_CONTAINER)
  if (f.loc) and.push({ locationCode: like(f.loc) })
  if (f.lockind === "none") and.push({ locationCode: null })
  else if (f.lockind) and.push({ locationKind: f.lockind })
  if (f.receipt) and.push({ receiptId: { equals: f.receipt, mode: "insensitive" } })
  const from = f.from ? londonStartOfDay(f.from) : null
  const to = f.to ? londonStartOfDay(f.to, 1) : null
  if (from) and.push({ createdAt: { gte: from } })
  if (to) and.push({ createdAt: { lt: to } })
  if (f.nolabel) and.push({ labelPrintedAt: null })
  // Totes on a check-in not booked in yet, or on a voided receipt, aren't standing goods — out unless asked for.
  if (!f.all) and.push({ receipt: { OR: [{ status: null }, { status: { notIn: ["draft", "void"] } }] } })
  return and.length ? { AND: and } : {}
}

export function toteOrderBy(f: ToteFilter): Prisma.GoodsInContainerOrderByWithRelationInput[] {
  const d = f.dir
  const tail: Prisma.GoodsInContainerOrderByWithRelationInput = { id: "asc" }
  switch (f.sort) {
    case "id": return [{ id: d }]
    case "status": return [{ status: { sort: d, nulls: "first" } }, tail]
    case "location": return [{ locationCode: { sort: d, nulls: "last" } }, tail]
    case "moved": return [{ movedAt: { sort: d, nulls: "last" } }, tail]
    case "receipt": return [{ receiptId: d }, tail]
    case "customer": return [{ receipt: { person: { name: { sort: d, nulls: "last" } } } }, tail]
    case "category": return [{ category: { sort: d, nulls: "last" } }, tail]
    default: return [{ createdAt: d }, tail]
  }
}

/** What the page and the export read for each row. */
export const TOTE_SELECT = {
  id: true, kind: true, category: true, description: true, status: true, locationCode: true, locationKind: true, movedAt: true,
  labelPrintedAt: true, createdAt: true, updatedAt: true, createdByName: true, source: true, receiptId: true,
  receipt: { select: { status: true, vendorNo: true, customerId: true, source: true, customer: true, person: { select: { name: true, name2: true } } } },
} satisfies Prisma.GoodsInContainerSelect
export type ToteRecord = Prisma.GoodsInContainerGetPayload<{ select: typeof TOTE_SELECT }>
