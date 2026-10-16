import { LOCATION_KINDS, normaliseCode, type LocationKind } from "@/lib/goods-in/model"
import { compareCodes, LOCATION_AREAS, locationCollator, parseLocationCode, type CodeParts, type LocationArea } from "@/lib/goods-in/location-codes"

// Goods In → Locations: the list's filters, worked out in the browser. Pure — no React.
//
// Every filter lives in the address (?area=aisle&aisle=10&status=off…) so Back, a refresh and a
// shared link all keep them. readFilters() turns the address into Filters (anything it doesn't
// recognise falls back to the default rather than emptying the list); filtersToQuery() writes only
// what differs from the default, in a fixed order, so the same filters always make the same link.
// Only ever compute on Row (parsed once per load) — ~2,500 locations must stay snappy.

/** One location as the server sends it. */
export type LocationItem = {
  code: string
  name: string | null
  kind: LocationKind
  active: boolean
  /** Totes and pallets there now (a returned one doesn't count). */
  totes: number
  /** Lots whose latest move was to here. */
  lots: number
  /** ISO. */
  createdAt: string
  /** ISO — the latest move into or out of it; null when no move was ever recorded. */
  lastUsedAt: string | null
  /** Anything ever moved in or out, or any tote or pallet (even a returned one) ever recorded there. */
  everUsed: boolean
}

/** A location with its code read once, ready for filtering and sorting. */
export type Row = LocationItem & {
  parts: CodeParts
  nameLower: string
  usedMs: number | null
  addedMs: number
  /** Its place in natural code order — the tie-break for every other sort. */
  order: number
}

const ms = (iso: string | null) => {
  if (!iso) return null
  const t = Date.parse(iso)
  return Number.isNaN(t) ? null : t
}

/** Parse every code once and put the list in natural code order (A2A1 before A10A1). */
export function toRows(items: LocationItem[]): Row[] {
  return [...items]
    .sort((a, b) => compareCodes(a.code, b.code))
    .map((it, i) => ({
      ...it,
      parts: parseLocationCode(it.code),
      nameLower: (it.name ?? "").toLowerCase(),
      usedMs: ms(it.lastUsedAt),
      addedMs: ms(it.createdAt) ?? 0,
      order: i,
    }))
}

// ─── The filters ────────────────────────────────────────────────────────────────────────────

export type StatusFilter = "on" | "off" | "all"
export type ContentsFilter = "any" | "empty" | "totes" | "lots" | "goods"
/** "in30" = used in the last 30 days; "30" = NOT used in the last 30 days (never used included). */
export type UsedFilter = "any" | "in30" | "in90" | "never" | "30" | "90" | "365"
export type SortKey = "code" | "name" | "totes" | "lots" | "used" | "unused" | "added" | "oldest"

/**
 * sessionStorage key holding the list's current query string, so a location's page can send the
 * manager back to the same filtered list after deleting it. A convenience only — every read and
 * write is in try/catch, and the page works without it.
 */
export const LIST_QUERY_KEY = "goods-in:locations-query"
/** sessionStorage key holding the ticked codes, so a look at one location and Back keeps them. */
export const TICKED_KEY = "goods-in:locations-ticked"

export type Filters = {
  q: string
  kind: LocationKind | "all"
  area: LocationArea | "all"
  /** Aisle number, only with area = aisle. */
  aisle: string
  /** Bay letter, only with area = aisle. */
  bay: string
  /** Shelf level, only with area = aisle. */
  shelf: string
  /** Cabinet number, only with area = cabinet. */
  cabinet: string
  status: StatusFilter
  contents: ContentsFilter
  used: UsedFilter
  sort: SortKey
}

export const DEFAULT_FILTERS: Filters = {
  q: "", kind: "all", area: "all", aisle: "", bay: "", shelf: "", cabinet: "",
  status: "on", contents: "any", used: "any", sort: "code",
}

export const STATUS_OPTIONS: { value: StatusFilter; label: string }[] = [
  { value: "on", label: "In use" },
  { value: "off", label: "Switched off" },
  { value: "all", label: "All" },
]
export const CONTENTS_OPTIONS: { value: ContentsFilter; label: string }[] = [
  { value: "any", label: "Anything" },
  { value: "empty", label: "Empty" },
  { value: "totes", label: "Has totes or pallets" },
  { value: "lots", label: "Has lots" },
  { value: "goods", label: "Has goods" },
]
export const USED_OPTIONS: { value: UsedFilter; label: string }[] = [
  { value: "any", label: "Any time" },
  { value: "in30", label: "Used in the last 30 days" },
  { value: "in90", label: "Used in the last 90 days" },
  { value: "never", label: "Never used" },
  { value: "30", label: "Not used in 30 days" },
  { value: "90", label: "Not used in 90 days" },
  { value: "365", label: "Not used in a year" },
]
export const SORT_OPTIONS: { value: SortKey; label: string }[] = [
  { value: "code", label: "Code A–Z" },
  { value: "name", label: "Name A–Z" },
  { value: "totes", label: "Most totes & pallets" },
  { value: "lots", label: "Most lots" },
  { value: "used", label: "Most recently used" },
  { value: "unused", label: "Least recently used" },
  { value: "added", label: "Newest added" },
  { value: "oldest", label: "Oldest added" },
]

const KIND_VALUES = new Set<string>(LOCATION_KINDS.map(k => k.value))
const AREA_VALUES = new Set<string>(LOCATION_AREAS.map(a => a.value))
const oneOf = <T extends string>(v: string | null, options: { value: T }[], dflt: T): T =>
  (v && options.some(o => o.value === v) ? v : dflt) as T

/** Keep the filters consistent: aisle/bay/shelf only with Aisles, cabinet only with Cabinets. */
export function tidyFilters(f: Filters): Filters {
  const out = { ...f }
  if (out.area !== "aisle") { out.aisle = ""; out.bay = ""; out.shelf = "" }
  if (out.area !== "cabinet") out.cabinet = ""
  return out
}

/** The filters in an address's query string. Anything unrecognised falls back to the default. */
export function readFilters(sp: { get(key: string): string | null }): Filters {
  const digits = (v: string | null, max: number) => (v && new RegExp(`^\\d{1,${max}}$`).test(v) ? String(Number(v)) : "")
  const kind = sp.get("kind")
  const area = sp.get("area")
  const bay = (sp.get("bay") ?? "").toUpperCase()
  return tidyFilters({
    q: (sp.get("q") ?? "").slice(0, 100),
    kind: kind && KIND_VALUES.has(kind) ? (kind as LocationKind) : "all",
    area: area && AREA_VALUES.has(area) ? (area as LocationArea) : "all",
    aisle: digits(sp.get("aisle"), 3),
    bay: /^[A-Z]$/.test(bay) ? bay : "",
    shelf: digits(sp.get("shelf"), 2),
    cabinet: digits(sp.get("cabinet"), 3),
    status: oneOf(sp.get("status"), STATUS_OPTIONS, "on"),
    contents: oneOf(sp.get("contents"), CONTENTS_OPTIONS, "any"),
    used: oneOf(sp.get("used"), USED_OPTIONS, "any"),
    sort: oneOf(sp.get("sort"), SORT_OPTIONS, "code"),
  })
}

const QUERY_ORDER: (keyof Filters)[] = ["q", "kind", "area", "aisle", "bay", "shelf", "cabinet", "status", "contents", "used", "sort"]

/** The query string for these filters (no leading ?), holding only what differs from the default. */
export function filtersToQuery(f: Filters): string {
  const sp = new URLSearchParams()
  for (const k of QUERY_ORDER) {
    const v = k === "q" ? f.q.trim() : f[k]
    if (v && v !== DEFAULT_FILTERS[k]) sp.set(k, v)
  }
  return sp.toString()
}

// ─── Matching ───────────────────────────────────────────────────────────────────────────────

export type FacetKey = "q" | "kind" | "area" | "aisle" | "bay" | "shelf" | "cabinet" | "status" | "contents" | "used"
type Skip = ReadonlySet<FacetKey>

const DAY = 86_400_000

const CONTENTS_TEST: Record<Exclude<ContentsFilter, "any">, (r: Row) => boolean> = {
  empty: r => r.totes === 0 && r.lots === 0,
  totes: r => r.totes > 0,
  lots: r => r.lots > 0,
  goods: r => r.totes > 0 || r.lots > 0,
}

/**
 * "Used in the last N days" needs a dated move in that time. "Not used in N days" includes never
 * used — and a location used on a date nobody recorded.
 */
function usedTest(r: Row, used: Exclude<UsedFilter, "any">, now: number): boolean {
  switch (used) {
    case "never": return !r.everUsed
    case "in30": return r.usedMs !== null && r.usedMs >= now - 30 * DAY
    case "in90": return r.usedMs !== null && r.usedMs >= now - 90 * DAY
    default: return r.usedMs === null || r.usedMs < now - Number(used) * DAY
  }
}
const USED_TESTS = USED_OPTIONS.map(o => o.value).filter((v): v is Exclude<UsedFilter, "any"> => v !== "any")

/**
 * A test for one row against the filters. `skip` leaves some filters out — that is how the counts
 * beside each choice are worked out ("how many would there be if I picked this instead?").
 */
export function makeMatcher(f: Filters, now: number) {
  const code = normaliseCode(f.q)
  const words = f.q.trim().toLowerCase()
  const aisle = f.aisle ? Number(f.aisle) : null
  const cabinet = f.cabinet ? Number(f.cabinet) : null
  return (r: Row, skip?: Skip): boolean => {
    if (words && !skip?.has("q") && !(r.code.includes(code) || r.nameLower.includes(words))) return false
    if (f.kind !== "all" && !skip?.has("kind") && r.kind !== f.kind) return false
    if (f.area !== "all" && !skip?.has("area") && r.parts.area !== f.area) return false
    if (aisle !== null && !skip?.has("aisle") && r.parts.aisle !== aisle) return false
    if (f.bay && !skip?.has("bay") && r.parts.bay !== f.bay) return false
    if (f.shelf && !skip?.has("shelf") && r.parts.shelf !== f.shelf) return false
    if (cabinet !== null && !skip?.has("cabinet") && r.parts.cabinet !== cabinet) return false
    if (f.status !== "all" && !skip?.has("status") && r.active !== (f.status === "on")) return false
    if (f.contents !== "any" && !skip?.has("contents") && !CONTENTS_TEST[f.contents](r)) return false
    if (f.used !== "any" && !skip?.has("used") && !usedTest(r, f.used, now)) return false
    return true
  }
}

/** The list in the order asked for. Ties fall back to natural code order. */
export function sortRows(rows: Row[], sort: SortKey): Row[] {
  if (sort === "code") return [...rows].sort((a, b) => a.order - b.order)
  // Never used sorts as the oldest of all; used but with no date recorded, just after it.
  const usedKey = (r: Row) => r.usedMs ?? (r.everUsed ? Number.MIN_SAFE_INTEGER : -Infinity)
  const by: Record<Exclude<SortKey, "code">, (a: Row, b: Row) => number> = {
    // Locations with no name go after the named ones.
    name: (a, b) => (a.name ? (b.name ? locationCollator.compare(a.name, b.name) : -1) : b.name ? 1 : 0),
    totes: (a, b) => b.totes - a.totes,
    lots: (a, b) => b.lots - a.lots,
    // Most recently used first; never used (or no date) last.
    used: (a, b) => usedKey(b) - usedKey(a) || 0,
    // The stale ones first: never used, then the longest since anything moved in or out.
    unused: (a, b) => usedKey(a) - usedKey(b) || 0,
    added: (a, b) => b.addedMs - a.addedMs,
    oldest: (a, b) => a.addedMs - b.addedMs,
  }
  const cmp = by[sort]
  return [...rows].sort((a, b) => cmp(a, b) || a.order - b.order)
}

// ─── Counts beside each choice ──────────────────────────────────────────────────────────────

export type Option = { value: string; label: string; count: number }

export type Facets = {
  /** How many match every filter — what the list shows now, and so the count beside whichever choice is picked. */
  total: number
  kind: Record<string, number>
  area: Record<string, number>
  status: Record<StatusFilter, number>
  contents: Record<ContentsFilter, number>
  used: Record<UsedFilter, number>
  aisles: Option[]
  bays: Option[]
  shelves: Option[]
  cabinets: Option[]
  /** "All aisles" / "All bays" / "All shelves" / "All cabinets": that one filter taken off, the rest kept. */
  aisleAll: number
  bayAll: number
  shelfAll: number
  cabinetAll: number
}

// Picking an area clears aisle, bay, shelf and cabinet; picking an aisle clears bay and shelf;
// picking a bay clears the shelf (filter-bar.tsx) — so each choice is counted with those cleared,
// and the count beside it is exactly what picking it shows. Picking "All …" clears only itself.
const skipOf = (...k: FacetKey[]): Skip => new Set(k)
const SKIP_KIND = skipOf("kind")
const SKIP_AREA = skipOf("area", "aisle", "bay", "shelf", "cabinet")
const SKIP_STATUS = skipOf("status")
const SKIP_CONTENTS = skipOf("contents")
const SKIP_USED = skipOf("used")
const SKIP_AISLE = skipOf("aisle", "bay", "shelf")
const SKIP_AISLE_ONLY = skipOf("aisle")
const SKIP_BAY = skipOf("bay", "shelf")
const SKIP_BAY_ONLY = skipOf("bay")
const SKIP_SHELF = skipOf("shelf")
const SKIP_CABINET = skipOf("cabinet")

function options<T extends string | number>(
  counts: Map<T, number>, selected: string, label: (v: T) => string, order: (a: T, b: T) => number, parse: (s: string) => T,
): Option[] {
  if (selected && !counts.has(parse(selected))) counts.set(parse(selected), 0)
  return [...counts.entries()].sort((a, b) => order(a[0], b[0])).map(([v, count]) => ({ value: String(v), label: label(v), count }))
}

/**
 * How many locations each choice would show, given every OTHER filter — so a kind tab, an area or
 * an aisle never offers a count that isn't what you'd get by picking it.
 */
export function computeFacets(rows: Row[], f: Filters, now: number): Facets {
  const m = makeMatcher(f, now)
  let total = 0
  const kind: Record<string, number> = { all: 0 }
  const area: Record<string, number> = { all: 0 }
  const status: Record<StatusFilter, number> = { on: 0, off: 0, all: 0 }
  const contents: Record<ContentsFilter, number> = { any: 0, empty: 0, totes: 0, lots: 0, goods: 0 }
  const used = Object.fromEntries(USED_OPTIONS.map(o => [o.value, 0])) as Record<UsedFilter, number>
  const aisles = new Map<number, number>()
  const bays = new Map<string, number>()
  const shelves = new Map<string, number>()
  const cabinets = new Map<number, number>()
  let aisleAll = 0, bayAll = 0, shelfAll = 0, cabinetAll = 0
  const inc = <K>(map: Map<K, number>, k: K) => map.set(k, (map.get(k) ?? 0) + 1)

  for (const r of rows) {
    if (m(r)) total++
    if (m(r, SKIP_KIND)) { kind.all++; kind[r.kind] = (kind[r.kind] ?? 0) + 1 }
    if (m(r, SKIP_AREA)) { area.all++; area[r.parts.area] = (area[r.parts.area] ?? 0) + 1 }
    if (m(r, SKIP_STATUS)) { status.all++; status[r.active ? "on" : "off"]++ }
    if (m(r, SKIP_CONTENTS)) {
      contents.any++
      for (const k of ["empty", "totes", "lots", "goods"] as const) if (CONTENTS_TEST[k](r)) contents[k]++
    }
    if (m(r, SKIP_USED)) {
      used.any++
      for (const k of USED_TESTS) if (usedTest(r, k, now)) used[k]++
    }
    if (f.area === "aisle" && r.parts.area === "aisle") {
      if (r.parts.aisle !== null && m(r, SKIP_AISLE)) inc(aisles, r.parts.aisle)
      if (m(r, SKIP_AISLE_ONLY)) aisleAll++
      if (r.parts.bay && m(r, SKIP_BAY)) inc(bays, r.parts.bay)
      if (m(r, SKIP_BAY_ONLY)) bayAll++
      // A60A-style codes have no shelf: they're in "All shelves" but under no single shelf.
      if (m(r, SKIP_SHELF)) { shelfAll++; if (r.parts.shelf) inc(shelves, r.parts.shelf) }
    }
    if (f.area === "cabinet" && r.parts.area === "cabinet" && m(r, SKIP_CABINET)) {
      cabinetAll++
      if (r.parts.cabinet !== null) inc(cabinets, r.parts.cabinet)
    }
  }

  return {
    total, aisleAll, bayAll, shelfAll, cabinetAll,
    kind, area, status, contents, used,
    aisles: options(aisles, f.aisle, v => `Aisle ${v}`, (a, b) => a - b, Number),
    bays: options(bays, f.bay, v => `Bay ${v}`, (a, b) => a.localeCompare(b), s => s),
    shelves: options(shelves, f.shelf, v => `Shelf ${v}`, compareCodes, s => s),
    cabinets: options(cabinets, f.cabinet, v => `Cabinet ${v}`, (a, b) => a - b, Number),
  }
}

// ─── The filters as removable chips ─────────────────────────────────────────────────────────

export type Chip = { id: string; label: string; clear: Partial<Filters> }

const labelOf = <T extends string>(list: { value: T; label: string }[], v: T) => list.find(o => o.value === v)?.label ?? v

/** Each filter that is on, worded for a chip, with what removing it changes. Sort isn't a filter. */
export function filterChips(f: Filters): Chip[] {
  const chips: Chip[] = []
  if (f.q.trim()) chips.push({ id: "q", label: `Search: ${f.q.trim()}`, clear: { q: "" } })
  if (f.kind !== "all") chips.push({ id: "kind", label: `Kind: ${labelOf(LOCATION_KINDS, f.kind)}`, clear: { kind: "all" } })
  if (f.area !== "all") chips.push({ id: "area", label: labelOf(LOCATION_AREAS, f.area), clear: { area: "all", aisle: "", bay: "", shelf: "", cabinet: "" } })
  if (f.aisle) chips.push({ id: "aisle", label: `Aisle ${f.aisle}`, clear: { aisle: "" } })
  if (f.bay) chips.push({ id: "bay", label: `Bay ${f.bay}`, clear: { bay: "" } })
  if (f.shelf) chips.push({ id: "shelf", label: `Shelf ${f.shelf}`, clear: { shelf: "" } })
  if (f.cabinet) chips.push({ id: "cabinet", label: `Cabinet ${f.cabinet}`, clear: { cabinet: "" } })
  if (f.status === "off") chips.push({ id: "status", label: "Switched off only", clear: { status: "on" } })
  if (f.status === "all") chips.push({ id: "status", label: "In use and switched off", clear: { status: "on" } })
  if (f.contents !== "any") chips.push({ id: "contents", label: labelOf(CONTENTS_OPTIONS, f.contents), clear: { contents: "any" } })
  if (f.used !== "any") chips.push({ id: "used", label: labelOf(USED_OPTIONS, f.used), clear: { used: "any" } })
  return chips
}

/** Every filter back to its default. The sort order stays as chosen. */
export const clearedFilters = (f: Filters): Filters => ({ ...DEFAULT_FILTERS, sort: f.sort })

// ─── What removing would do ─────────────────────────────────────────────────────────────────

/**
 * What "Remove" will do to these locations, judged from the list's own figures (the server checks
 * again and has the last word): goods still there → refused; used before → switched off and kept
 * for its history; never used and empty → deleted.
 */
export function predictRemoval(rows: Row[]) {
  const deleted: Row[] = [], switchedOff: Row[] = [], alreadyOff: Row[] = [], refused: Row[] = []
  for (const r of rows) {
    if (r.totes > 0 || r.lots > 0) refused.push(r)
    else if (!r.everUsed) deleted.push(r)
    else if (r.active) switchedOff.push(r)
    else alreadyOff.push(r)
  }
  return { deleted, switchedOff, alreadyOff, refused }
}

// ─── Words ──────────────────────────────────────────────────────────────────────────────────

export const n = (x: number) => x.toLocaleString("en-GB")
export const plural = (x: number, one: string, many: string) => `${n(x)} ${x === 1 ? one : many}`

/** "2 totes or pallets and 1 lot" — what's at a location, in words. */
export function goodsWords(totes: number, lots: number): string {
  const parts = [totes > 0 ? plural(totes, "tote or pallet", "totes or pallets") : null, lots > 0 ? plural(lots, "lot", "lots") : null].filter(Boolean)
  return parts.length ? parts.join(" and ") : "nothing"
}
