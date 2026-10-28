// Admin & Operations → 🏷️ Barcode Labels (Jack, 2026-10-28: "we need a new barcode panel — an easy
// way to print them; it currently uses a mail merge and it confuses most people", and "it needs to
// follow the exact template to fit on the sheets — we print around 600 per sale").
//
// A Lot ID label is the sale code and a running number — X160001, X160002 … — printed on Avery L7651
// sheets (A4, 65 a sheet), each label: the sale date, the Code 39 barcode, the number in big bold.
// The old way: an Excel "LotID Label Generator" fed a Word mail merge ("Avery_38x21-R EDIT.docx").
// The Hub makes the same sheets as ONE PDF from the sale, the first number and how many.
//
// PURE and client-safe — the sheet's measurements, the numbering, reading what was asked. The PDF is
// lib/barcode-labels-pdf.ts (server), the print log lib/barcode-labels-server.ts.

import { code39Units, isCode39Text } from "@/lib/code39"

export const BARCODES_PATH = "/tools/barcodes"

/**
 * The sheet, EXACTLY as the Word template lays it out — in twips (1/20 pt, Word's own unit, so
 * nothing is rounded): A4; the table 10.0 mm from the top and 6.1 mm from the left (Word 2013 layout,
 * no table indent, so the first column starts at the margin); 5 columns of 38.1 mm with 2.52 mm gaps;
 * 13 rows exactly 21.17 mm; 1.27 mm padding inside each label. Avery L7651 — 38.1 × 21.2 mm, 65 a sheet.
 */
export const SHEET = {
  top: 567,
  left: 346,
  labelW: 2160,
  gap: 143,
  labelH: 1200,
  padX: 72,
  cols: 5,
  rows: 13,
} as const
export const PER_SHEET = SHEET.cols * SHEET.rows

/**
 * The label's insides, as the template sets them — Arial (Helvetica here: the same widths), single
 * spacing (1.15 em a line, ascent 0.905 em), the three lines centred in the 60 pt cell as Word does:
 * 1 pt before + the date (8 pt, a 9.2 pt line) + the barcode (Libre Barcode 39 at 22 pt on an EXACT
 * 16 pt line — narrow bar 0.03 em = 0.2328 mm, bars 0.59 em tall, measured from the font) + the number
 * (24 pt bold, a 27.6 pt line) = 53.8 pt, so 3.1 pt above. Positions from the label's top edge, in
 * points. The barcode and the number start AT the cell's left edge (their paragraphs are indented −74 /
 * −75 twips, cancelling the 72-twip cell padding); only the date sits inside the padding.
 */
export const LABEL = {
  dateSize: 8,
  dateBaseline: 11.3,
  barNarrowMm: 0.2328,
  barTop: 13.5,
  barHeight: 13,
  numberSize: 24,
  numberBaseline: 51,
  /** Twips the barcode and the number sit left of the cell padding (the paragraphs' negative indent). */
  barIndent: -74,
  numberIndent: -75,
} as const

/**
 * The real stickers on an Avery L7651 sheet (Avery's published layout, in mm) — what "Test on plain
 * paper" outlines, to hold up against a sheet. The template's grid sits on them: its cells start 1.35
 * mm right of and 0.7 mm above the stickers, which the centred, padded contents absorb.
 */
export const STICKERS = { topMm: 10.7, leftMm: 4.75, wMm: 38.1, hMm: 21.2, pitchXMm: 40.6, pitchYMm: 21.2 } as const

/** At most this many labels in one PDF (20 sheets) — a sale is around 600. */
export const MAX_LABELS = 1300
/** The highest running number (a sale's labels run 001–999, then 1000 on). */
export const MAX_NUMBER = 9999

/** A sale code: a letter or two, then three or four digits (F078, E050, X160). */
export const SALE_RE = /^[A-Z]{1,2}\d{3,4}$/

/** The label's barcode: the sale and its running number, at least 3 digits (X160 + 1 → X160001). */
export const barcodeOf = (sale: string, n: number): string => `${sale}${String(n).padStart(3, "0")}`

/** The sheets a run takes, starting on label `startAt` of the first one. */
export const sheetsFor = (count: number, startAt = 1): number => Math.ceil((startAt - 1 + count) / PER_SHEET)

/** YYYY-MM-DD → dd/mm/yyyy, as the template prints it. */
export const labelDate = (day: string): string => (/^\d{4}-\d{2}-\d{2}$/.test(day) ? `${day.slice(8, 10)}/${day.slice(5, 7)}/${day.slice(0, 4)}` : "")

/** What to print. */
export type LabelRun = {
  /** Upper case, SALE_RE. */
  sale: string
  /** YYYY-MM-DD — printed on every label; "" prints none. */
  date: string
  /** The first running number. */
  from: number
  count: number
  /** The first sheet starts on this label (1–65) — for a sheet some labels are already gone from. */
  startAt: number
}

/** Why a run can't be printed, in words — null when it can. */
export function runProblem(r: { sale: string; date: string; from: number; count: number; startAt: number }): string | null {
  if (!r.sale) return "Pick the sale (or type its code, for example X160)."
  if (!SALE_RE.test(r.sale)) return `"${r.sale}" doesn't look like a sale code — a letter or two then three or four digits, for example X160.`
  if (r.date && !/^\d{4}-\d{2}-\d{2}$/.test(r.date)) return "The sale date isn't a date — pick it from the calendar."
  if (!Number.isInteger(r.from) || r.from < 1 || r.from > MAX_NUMBER) return `The first number must be a whole number from 1 to ${MAX_NUMBER}.`
  if (!Number.isInteger(r.count) || r.count < 1) return "How many labels? At least 1."
  if (r.count > MAX_LABELS) return `That's more than ${MAX_LABELS.toLocaleString("en-GB")} labels (${MAX_LABELS / PER_SHEET} sheets) — print it in two goes.`
  if (r.from + r.count - 1 > MAX_NUMBER) return `That runs past ${barcodeOf(r.sale, MAX_NUMBER)} — start lower or print fewer.`
  if (!Number.isInteger(r.startAt) || r.startAt < 1 || r.startAt > PER_SHEET) return `Start on a label from 1 to ${PER_SHEET}.`
  if (!isCode39Text(barcodeOf(r.sale, r.from))) return "That sale code can't go in a barcode."
  return null
}

/** Reads a run from a form or JSON (strings or numbers) — the fields as typed; check with runProblem. */
export function readRun(v: Record<string, unknown>): LabelRun {
  const text = (k: string) => (typeof v[k] === "string" ? (v[k] as string) : typeof v[k] === "number" ? String(v[k]) : "").trim()
  const whole = (k: string, dflt: number) => { const s = text(k); return s === "" ? dflt : /^\d{1,6}$/.test(s) ? Number(s) : NaN }
  return {
    sale: text("sale").toUpperCase().replace(/\s+/g, ""),
    date: text("date"),
    from: whole("from", 1),
    count: whole("count", 0),
    startAt: whole("startAt", 1),
  }
}

/** The width (pt) a barcode or number may take — the cell less its padding (35.56 mm). Starting at the
 *  cell's edge, that ends 1.2 mm inside the real sticker's right edge (the template's cells sit 1.35 mm
 *  right of the stickers), so a long code never runs off it. */
export const ROOM_PT = (SHEET.labelW - 2 * SHEET.padX) / 20

/** The narrow bar width (mm) for `text` on a label: the template's, made narrower only when a longer
 *  code wouldn't fit ROOM_PT. */
export function barNarrowFor(text: string): number {
  return Math.min(LABEL.barNarrowMm, ((ROOM_PT * 25.4) / 72) / code39Units(text))
}

/** A run in words: "X160001 – X160650 · 650 labels · 10 sheets". */
export function runWords(r: LabelRun): string {
  const last = barcodeOf(r.sale, r.from + r.count - 1)
  const sheets = sheetsFor(r.count, r.startAt)
  return `${barcodeOf(r.sale, r.from)}${r.count > 1 ? ` – ${last}` : ""} · ${r.count.toLocaleString("en-GB")} label${r.count === 1 ? "" : "s"} · ${sheets} sheet${sheets === 1 ? "" : "s"}`
}

/** One PDF made — what the page lists, and what the next run's first number follows on from. */
export type LabelRunRow = {
  id: string
  sale: string
  date: string | null
  from: number
  to: number
  count: number
  startAt: number
  byName: string
  /** ISO. */
  at: string
}

/** A sale to pick: its code, name and date (YYYY-MM-DD), and how many lots BC has allocated to it. */
export type LabelSale = { code: string; name: string; date: string; lots: number }

/** The runs already made for `sale` that share numbers with from…from+count-1. */
export const overlapping = (runs: LabelRunRow[], sale: string, from: number, count: number): LabelRunRow[] =>
  runs.filter((x) => x.sale === sale && x.from <= from + count - 1 && x.to >= from)

/** The number after the highest already made for `sale` (1 when none). */
export const nextFrom = (runs: LabelRunRow[], sale: string): number =>
  runs.filter((x) => x.sale === sale).reduce((n, x) => Math.max(n, x.to + 1), 1)
