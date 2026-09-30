import * as XLSX from "xlsx"

// Reads a Business Central "Lines" export (the Auction Lines Excel — the same file BC Match and
// the Description Copier take) into the lot shape the Saleroom Trainer's Test Mode runs.
//
// ⚠ WHY (2026-09-29, Jordan, Auto Clerk Scenario 2): the fake Saleroom must show THE SAME LOTS as
// the real Vectis clerking screen, in the same order with the same lot numbers, or a two-screen test
// proves nothing. The Hub's own lots can never give that — CatalogueLot has no lot number and no sale
// order — while BC's export has both. The lot NUMBER is the id here (the real Saleroom shows the
// number, not the barcode), so the AHK clerk's lot watch reads the same token on both screens.
//
// Pure: bytes in, lots out. No database, nothing written. Tested against a real export by
// scripts in this repo's history — keep it that way so a column rename is caught by a test.

export type SheetLot = {
  /** The lot number as the trainer shows it — "12", or "12A" with BC's suffix. */
  id: string
  /** "30-50" · "30+" · "" — the trainer's own estimate format. */
  est: string
  desc: string
  barcode: string
  uniqueId: string
}

export type SheetResult = {
  /** Sale code, worked out from the barcodes (F118022 → F118). Null when they don't agree. */
  code: string | null
  lots: SheetLot[]
  /** Every row that had a lot number and wasn't withdrawn — before the cap. */
  total: number
  /** Rows left out because BC hasn't numbered them yet (Lot No. blank or 0). */
  unnumbered: number
  /** Rows left out because BC marks the lot withdrawn. */
  withdrawn: number
}

/** More than this is a whole sale in a browser tab — the picker says what it left out. */
export const MAX_SHEET_LOTS = 2000

// Header names as BC prints them. Matched trimmed and case-insensitively, so a stray space in an
// export doesn't turn into "no Lot No. column".
const COLS = {
  lotNo:    "lot no.",
  suffix:   "lot suffix",
  barcode:  "internal barcode",
  uniqueId: "uniqueid",
  longDesc: "catalogue description",
  shortDesc: "short description",
  low:      "low estimate",
  high:     "high estimate",
  withdrawn: "withdraw lot",
} as const

const str = (v: unknown) => (v == null ? "" : String(v)).trim()
const num = (v: unknown) => { const n = Number(String(v ?? "").replace(/[£,\s]/g, "")); return Number.isFinite(n) ? n : null }

function findCols(header: unknown[]): Partial<Record<keyof typeof COLS, number>> {
  const out: Partial<Record<keyof typeof COLS, number>> = {}
  header.forEach((h, i) => {
    const key = str(h).toLowerCase()
    for (const [name, want] of Object.entries(COLS) as [keyof typeof COLS, string][]) {
      if (key === want && out[name] === undefined) out[name] = i
    }
  })
  return out
}

/**
 * Parse the export. Throws a plain-English Error when the file isn't a Lines export — the
 * caller shows the message as it is.
 */
export function parseLinesSheet(buf: Buffer): SheetResult {
  let wb: XLSX.WorkBook
  try {
    wb = XLSX.read(buf, { type: "buffer" })
  } catch {
    throw new Error("That file couldn't be read as a spreadsheet — it should be the .xlsx BC saves from the Lines page.")
  }
  const ws = wb.Sheets[wb.SheetNames[0]]
  if (!ws) throw new Error("The spreadsheet has no sheets in it.")
  const rows = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: "", raw: true })
  if (rows.length < 2) throw new Error("The sheet has a header row but no lots under it.")

  const col = findCols(rows[0])
  if (col.lotNo === undefined) {
    throw new Error("This doesn't look like a BC Lines export — there is no \"Lot No.\" column. Export the sale's lines from Business Central (the same file BC Match takes).")
  }
  const has = (k: keyof typeof COLS) => col[k] !== undefined
  const cell = (row: unknown[], k: keyof typeof COLS) => (has(k) ? row[col[k]!] : "")

  const keep: { n: number; suffix: string; lot: SheetLot }[] = []
  let unnumbered = 0, withdrawn = 0
  const prefixes = new Map<string, number>()

  for (const row of rows.slice(1)) {
    if (!row || row.every(v => str(v) === "")) continue   // a blank line at the foot
    const n = num(cell(row, "lotNo"))
    if (!n || n <= 0) { unnumbered++; continue }
    if (has("withdrawn") && str(cell(row, "withdrawn")).toLowerCase() === "yes") { withdrawn++; continue }
    if (has("withdrawn") && (cell(row, "withdrawn") === true || num(cell(row, "withdrawn")) === 1)) { withdrawn++; continue }

    const suffix   = str(cell(row, "suffix")).toUpperCase()
    const barcode  = str(cell(row, "barcode"))
    const uniqueId = str(cell(row, "uniqueId"))
    const low  = num(cell(row, "low"))
    const high = num(cell(row, "high"))
    // The short description is BC's own 80-character cut with a "…" on the end — only a fallback.
    const desc = str(cell(row, "longDesc")) || str(cell(row, "shortDesc")) || "—"
    const est  = low != null && high != null && high > 0 ? `${low}-${high}`
               : low != null && low > 0 ? `${low}+`
               : ""
    const m = /^([A-Za-z]\d{3})\d+$/.exec(barcode)
    if (m) prefixes.set(m[1].toUpperCase(), (prefixes.get(m[1].toUpperCase()) ?? 0) + 1)

    keep.push({ n, suffix, lot: { id: `${n}${suffix}`, est, desc, barcode, uniqueId } })
  }

  // Lot order — the order the live sale takes them, suffix lots straight after their number.
  keep.sort((a, b) => a.n - b.n || a.suffix.localeCompare(b.suffix))

  // The sale code: the prefix MOST of the barcodes carry. Not "all of them" — a barcode belongs
  // to the sale the item was first labelled in, so a lot re-entered from an earlier sale keeps
  // its old one (measured on F118's own export: 635 × F118, 39 re-entered lots carrying barcodes
  // from seven earlier sales — F077, F037, F091…).
  let code: string | null = null
  let best = 0
  for (const [p, n] of prefixes) if (n > best) { best = n; code = p }
  if (best * 2 <= keep.length) code = null   // no prefix holds a majority — don't guess

  return {
    code,
    lots: keep.slice(0, MAX_SHEET_LOTS).map(k => k.lot),
    total: keep.length,
    unnumbered,
    withdrawn,
  }
}
