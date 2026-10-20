import { LOCATION_KINDS, normaliseCode, type LocationKind } from "./model"

// Reading and making Goods In location codes. Pure functions only — safe on the server and in the
// browser. The warehouse's full list (lib/goods-in/location-list.json, 3,920 codes from its own
// spreadsheet, 2026-10-20) follows a few patterns, and the Locations screen filters on them:
//
//   A10A1    Aisle 10, Bay A, Shelf 1     A{aisle}{bay letter}{shelf number}
//   10A1     Aisle 10, Bay A, Shelf 1     the same without the A — the list has both forms
//   11A1A    Aisle 11, Bay A, Shelf 1A    a half-shelf: shelf number + A/B
//   A60A     Aisle 60, Bay A              {aisle}{bay letter} — no shelf level  (a few)
//   BENCH3   Bench 3                      BENCH{number}                          (64)
//   CAB5E    Cabinet 5, Shelf E           CAB{cabinet}{shelf letter}             (36)
//   anything else — CAGE0001, RETURNED, DISPOSAL, CHECK-IN, ADMIN_OFF, ARCHIVE… — is a "named area".
//
// ⚠ ARCHIVE starts with A but has no digits after it, so it is a named area, not an aisle.
// ⚠ Codes are stored normalised (normaliseCode: spaces removed, upper case) — "MEL OFFICE" on the
//   warehouse's list is MELOFFICE here.

/** What a location code may be: letters and numbers (and - _ / .), up to 24 characters, no spaces. */
export const LOCATION_CODE_RULE = /^[A-Z0-9][A-Z0-9_\-/.]{0,23}$/
export const LOCATION_CODE_HELP = "A location code is letters and numbers (and - _ / .), up to 24 characters, with no spaces."

/** The most locations one bulk add, change or remove may touch at once. */
export const MAX_BULK_LOCATIONS = 2000

export type LocationArea = "aisle" | "bench" | "cabinet" | "named"

export const LOCATION_AREAS: { value: LocationArea; label: string; help: string }[] = [
  { value: "aisle", label: "Aisles", help: "Racking — A10A1 (or 10A1) is Aisle 10, Bay A, Shelf 1; 11A1A is half-shelf 1A." },
  { value: "bench", label: "Benches", help: "BENCH1, BENCH2… — the numbered cataloguing benches." },
  { value: "cabinet", label: "Cabinets", help: "CAB5E is Cabinet 5, Shelf E." },
  { value: "named", label: "Named areas", help: "Everything else — Returned, Disposal, Check in, offices…" },
]

export type CodeParts = {
  area: LocationArea
  /** Aisle number for A10A1-style codes. */
  aisle: number | null
  /** Bay letter for A10A1-style codes. */
  bay: string | null
  /** Shelf level: "1"–"7" on aisles ("1A"/"1B" for a half-shelf), "A"–"F" in cabinets; null when the code has none. */
  shelf: string | null
  /** Bench number for BENCH3. */
  bench: number | null
  /** Cabinet number for CAB5E. */
  cabinet: number | null
}

// The A is optional (the warehouse's list has A10A1 and 10A1 for the same shelf) and a shelf may
// carry a half-shelf letter (11A1A). ⚠ ARCHIVE still isn't an aisle: digits must follow the A.
const AISLE = /^A?(\d{1,3})([A-Z])(?:(\d{1,2})([A-Z])?)?$/
const BENCH = /^BENCH(\d{1,4})$/
const CABINET = /^CAB(\d{1,3})([A-Z])?$/

/** Which part of the warehouse a code is in, and its aisle/bay/shelf where it has them. */
export function parseLocationCode(raw: string): CodeParts {
  const code = normaliseCode(raw)
  const none = { aisle: null, bay: null, shelf: null, bench: null, cabinet: null }
  let m = code.match(AISLE)
  if (m) return { ...none, area: "aisle", aisle: Number(m[1]), bay: m[2], shelf: m[3] ? String(Number(m[3])) + (m[4] ?? "") : null }
  m = code.match(BENCH)
  if (m) return { ...none, area: "bench", bench: Number(m[1]) }
  m = code.match(CABINET)
  if (m) return { ...none, area: "cabinet", cabinet: Number(m[1]), shelf: m[2] ?? null }
  return { ...none, area: "named" }
}

/** The name the warehouse's own list would give a code ("Aisle 10, Bay A, Shelf 1"), or null for a named area. */
export function defaultLocationName(raw: string): string | null {
  const p = parseLocationCode(raw)
  switch (p.area) {
    case "aisle": return [`Aisle ${p.aisle}`, `Bay ${p.bay}`, p.shelf ? `Shelf ${p.shelf}` : null].filter(Boolean).join(", ")
    case "bench": return `Bench ${p.bench}`
    case "cabinet": return [`Cabinet ${p.cabinet}`, p.shelf ? `Shelf ${p.shelf}` : null].filter(Boolean).join(", ")
    default: return null
  }
}

/** The kind a new code most likely is: benches are benches, everything else storage. */
export const defaultLocationKind = (raw: string): LocationKind => (parseLocationCode(raw).area === "bench" ? "bench" : "storage")

/** Natural order, so A2A1 comes before A10A1 and BENCH9 before BENCH10. */
export const locationCollator = new Intl.Collator("en-GB", { numeric: true, sensitivity: "base" })
export const compareCodes = (a: string, b: string) => locationCollator.compare(a, b)

// ─── Making a run of locations ─────────────────────────────────────────────────────────────

export type NewLocation = { code: string; name: string | null; kind: LocationKind }

export type RangeSpec =
  /** Aisles aisleFrom–aisleTo × bays bayFrom–bayTo × shelves shelfFrom–shelfTo, e.g. A70A1 … A70F6. */
  | { pattern: "aisle"; aisleFrom: number; aisleTo: number; bayFrom: string; bayTo: string; shelfFrom: number; shelfTo: number; kind?: LocationKind }
  /** BENCH{from}…BENCH{to}, made as benches. */
  | { pattern: "bench"; from: number; to: number }
  /** Cabinets cabinetFrom–cabinetTo × shelf letters shelfFrom–shelfTo, e.g. CAB7A … CAB7E. */
  | { pattern: "cabinet"; cabinetFrom: number; cabinetTo: number; shelfFrom: string; shelfTo: string; kind?: LocationKind }
  /** Any prefix and a number run: prefix "BAY" 1–20 with pad 2 → BAY01 … BAY20, named "{namePrefix} {n}". */
  | { pattern: "custom"; prefix: string; from: number; to: number; pad: number; namePrefix?: string | null; kind: LocationKind }

const whole = (n: unknown) => Number.isInteger(n) && (n as number) >= 0
const letter = (s: unknown) => typeof s === "string" && /^[A-Z]$/i.test(s)
const letters = (from: string, to: string) => {
  const a = from.toUpperCase().charCodeAt(0), b = to.toUpperCase().charCodeAt(0)
  return Array.from({ length: b - a + 1 }, (_, i) => String.fromCharCode(a + i))
}
const run = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => from + i)

/**
 * Every code a range makes, in order, with the name and kind each would be given — or the reason
 * the range can't be made. Never more than MAX_BULK_LOCATIONS.
 */
export function expandRange(spec: RangeSpec): { ok: true; rows: NewLocation[] } | { ok: false; error: string } {
  const rows: NewLocation[] = []
  const tooMany = (n: number) => ({ ok: false as const, error: `That makes ${n.toLocaleString("en-GB")} locations — no more than ${MAX_BULK_LOCATIONS.toLocaleString("en-GB")} can be added at once.` })
  switch (spec.pattern) {
    case "aisle": {
      const { aisleFrom, aisleTo, bayFrom, bayTo, shelfFrom, shelfTo } = spec
      if (![aisleFrom, aisleTo, shelfFrom, shelfTo].every(whole)) return { ok: false, error: "Aisles and shelves are whole numbers." }
      if (aisleFrom < 1 || aisleTo > 999) return { ok: false, error: "Aisles run from 1 to 999." }
      if (shelfFrom < 1 || shelfTo > 99) return { ok: false, error: "Shelves run from 1 to 99." }
      if (!letter(bayFrom) || !letter(bayTo)) return { ok: false, error: "A bay is a single letter, A to Z." }
      if (aisleFrom > aisleTo) return { ok: false, error: "The first aisle comes after the last one." }
      if (bayFrom.toUpperCase() > bayTo.toUpperCase()) return { ok: false, error: "The first bay comes after the last one." }
      if (shelfFrom > shelfTo) return { ok: false, error: "The first shelf comes after the last one." }
      const bays = letters(bayFrom, bayTo)
      const total = (aisleTo - aisleFrom + 1) * bays.length * (shelfTo - shelfFrom + 1)
      if (total > MAX_BULK_LOCATIONS) return tooMany(total)
      for (const a of run(aisleFrom, aisleTo)) for (const b of bays) for (const s of run(shelfFrom, shelfTo)) {
        rows.push({ code: `A${a}${b}${s}`, name: `Aisle ${a}, Bay ${b}, Shelf ${s}`, kind: spec.kind ?? "storage" })
      }
      break
    }
    case "bench": {
      if (![spec.from, spec.to].every(whole) || spec.from < 1 || spec.to > 9999) return { ok: false, error: "Bench numbers are whole numbers from 1 to 9999." }
      if (spec.from > spec.to) return { ok: false, error: "The first bench comes after the last one." }
      const total = spec.to - spec.from + 1
      if (total > MAX_BULK_LOCATIONS) return tooMany(total)
      for (const n of run(spec.from, spec.to)) rows.push({ code: `BENCH${n}`, name: `Bench ${n}`, kind: "bench" })
      break
    }
    case "cabinet": {
      const { cabinetFrom, cabinetTo, shelfFrom, shelfTo } = spec
      if (![cabinetFrom, cabinetTo].every(whole) || cabinetFrom < 1 || cabinetTo > 999) return { ok: false, error: "Cabinet numbers are whole numbers from 1 to 999." }
      if (!letter(shelfFrom) || !letter(shelfTo)) return { ok: false, error: "A cabinet shelf is a single letter, A to Z." }
      if (cabinetFrom > cabinetTo) return { ok: false, error: "The first cabinet comes after the last one." }
      if (shelfFrom.toUpperCase() > shelfTo.toUpperCase()) return { ok: false, error: "The first shelf comes after the last one." }
      const shelves = letters(shelfFrom, shelfTo)
      const total = (cabinetTo - cabinetFrom + 1) * shelves.length
      if (total > MAX_BULK_LOCATIONS) return tooMany(total)
      for (const c of run(cabinetFrom, cabinetTo)) for (const s of shelves) {
        rows.push({ code: `CAB${c}${s}`, name: `Cabinet ${c}, Shelf ${s}`, kind: spec.kind ?? "storage" })
      }
      break
    }
    case "custom": {
      const prefix = normaliseCode(spec.prefix ?? "")
      if (!prefix || !/^[A-Z][A-Z0-9\-/.]*$/.test(prefix)) return { ok: false, error: "The start of the code is letters (and numbers, - / .) with no spaces, beginning with a letter." }
      if (![spec.from, spec.to, spec.pad].every(whole)) return { ok: false, error: "The numbers are whole numbers." }
      if (spec.from > spec.to) return { ok: false, error: "The first number comes after the last one." }
      if (spec.pad > 6) return { ok: false, error: "Pad the number to 6 digits at most." }
      const total = spec.to - spec.from + 1
      if (total > MAX_BULK_LOCATIONS) return tooMany(total)
      const namePrefix = (spec.namePrefix ?? "").trim()
      for (const n of run(spec.from, spec.to)) {
        const code = `${prefix}${String(n).padStart(spec.pad, "0")}`
        if (!LOCATION_CODE_RULE.test(code)) return { ok: false, error: `${code} is too long — a location code is up to 24 characters.` }
        rows.push({ code, name: namePrefix ? `${namePrefix} ${n}` : null, kind: spec.kind })
      }
      break
    }
  }
  return { ok: true, rows }
}

// ─── Pasting a list ─────────────────────────────────────────────────────────────────────────

export type PasteProblem = { line: number; text: string; reason: string }

const KIND_WORDS = new Map<string, LocationKind>(
  LOCATION_KINDS.flatMap(k => [[k.value, k.value], [k.label.toLowerCase(), k.value]] as [string, LocationKind][]),
)

/**
 * One line of comma-separated text split into its cells, the way a spreadsheet writes them: a cell
 * in "double quotes" may hold commas, and "" inside it is one quote. So a CSV saved from Excel — or
 * the Locations screen's own export, whose names are "Aisle 10, Bay A, Shelf 1" — reads back right.
 */
export function splitCsvLine(line: string): string[] {
  const cells: string[] = []
  let cell = ""
  let quoted = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (quoted) {
      if (ch !== '"') cell += ch
      else if (line[i + 1] === '"') { cell += '"'; i++ }
      else quoted = false
    } else if (ch === '"' && cell.trim() === "") { quoted = true; cell = "" }
    else if (ch === ",") { cells.push(cell); cell = "" }
    else cell += ch
  }
  cells.push(cell)
  return cells
}

/** A spreadsheet column copied with quotes round it ("a ""b"" c") — Excel does that to a cell holding a quote. */
const unquote = (c: string) => {
  const t = c.trim()
  return t.length >= 2 && t.startsWith('"') && t.endsWith('"') ? t.slice(1, -1).replace(/""/g, '"') : t
}
/** The ' that csvCell puts before = + - @ taken off again, and the cell trimmed. */
const cleanCell = (c: string) => c.trim().replace(/^'(?=[=+\-@])/, "").trim()

/**
 * Read a pasted list — one location per line, as typed or copied from a spreadsheet:
 *   CODE
 *   CODE, name
 *   CODE <tab> name <tab> kind          (kind: storage, bench, shelf or other)
 * Comma lines follow spreadsheet quoting ("Aisle 10, Bay A", "" for a quote), so a saved CSV — the
 * Locations export included — reads back with its names whole. A heading line starting "code" is
 * skipped, blank lines are ignored, and a code that appears twice is kept once. With no name the
 * usual one is used (A10A1 → "Aisle 10, Bay A, Shelf 1"); with no kind, BENCH codes are benches
 * and everything else `fallbackKind`.
 */
export function parsePastedLocations(text: string, fallbackKind: LocationKind = "storage"): { rows: NewLocation[]; problems: PasteProblem[] } {
  const rows: NewLocation[] = []
  const problems: PasteProblem[] = []
  const seen = new Set<string>()
  const lines = (text ?? "").split(/\r?\n/)
  let first = true
  lines.forEach((rawLine, i) => {
    // trim() also takes off the byte-order mark a saved CSV starts with.
    const line = rawLine.trim()
    if (!line) return
    const cells = (line.includes("\t") ? line.split("\t").map(unquote) : splitCsvLine(line)).map(cleanCell)
    const heading = first && /^(location\s*)?code$/i.test(cells[0] ?? "")
    first = false
    if (heading) return
    const code = normaliseCode(cells[0] ?? "")
    if (!LOCATION_CODE_RULE.test(code)) { problems.push({ line: i + 1, text: rawLine, reason: LOCATION_CODE_HELP }); return }
    if (seen.has(code)) { problems.push({ line: i + 1, text: rawLine, reason: `${code} is already further up the list.` }); return }
    const kindWord = (cells[2] ?? "").toLowerCase()
    const kind = kindWord ? KIND_WORDS.get(kindWord) : undefined
    if (kindWord && !kind) { problems.push({ line: i + 1, text: rawLine, reason: `"${cells[2]}" isn't a kind — use storage, bench, shelf or other.` }); return }
    seen.add(code)
    const name = (cells[1] ?? "").trim() || defaultLocationName(code)
    rows.push({ code, name: name ? name.slice(0, 120) : null, kind: kind ?? (parseLocationCode(code).area === "bench" ? "bench" : fallbackKind) })
  })
  return { rows, problems }
}

// ─── Exporting ─────────────────────────────────────────────────────────────────────────────

/** One CSV cell, quoted when it has to be; a leading = + - @ is neutralised so a spreadsheet won't run it (parsePastedLocations takes that ' off again). */
export function csvCell(v: unknown): string {
  let s = v == null ? "" : String(v)
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}
