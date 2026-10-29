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
 * The sheet maker's own template — Labels4U "65tv – 38.1 x 21.2mm" (code ref L7651, the sheets we buy;
 * Jack sent it 2026-10-29), in twips (1/20 pt, Word's own unit): A4 (11905 × 16837); the first row
 * 10.88 mm from the top and the first column 4.66 mm from the left (264 tw margins both sides, so the
 * block is centred across); 5 columns of 38.1 mm with 2.54 mm gaps; 13 rows exactly 21.17 mm, touching;
 * text 1.22 mm inside each label (15 tw cell margin + 54 tw indent). The old mail merge's "Avery_38x21-R
 * EDIT.docx" had moved this grid 1.4 mm right and 0.9 mm up (10.0 mm / 6.1 mm margins, 143 tw gaps).
 */
export const SHEET = {
  top: 617,
  left: 264,
  labelW: 2160,
  gap: 144,
  labelH: 1200,
  padX: 69,
  cols: 5,
  rows: 13,
} as const
export const PER_SHEET = SHEET.cols * SHEET.rows

const MM_PER_TWIP = 25.4 / 1440

/**
 * The stickers, in mm — exactly the template's cells: 38.1 × 21.17, pitch 40.64 across and 21.17 down,
 * the first 4.66 mm from the left and 10.88 mm from the top. Each label's print is CENTRED on its sticker
 * (Jack, 2026-10-29: "have you made sure it fits on the paper" — "this doesn't line up"), so it can't
 * run off an edge; "Test on plain paper" outlines these, to hold up against a sheet.
 */
export const STICKERS = {
  wMm: SHEET.labelW * MM_PER_TWIP,
  hMm: SHEET.labelH * MM_PER_TWIP,
  pitchXMm: (SHEET.labelW + SHEET.gap) * MM_PER_TWIP,
  pitchYMm: SHEET.labelH * MM_PER_TWIP,
  leftMm: SHEET.left * MM_PER_TWIP,
  topMm: SHEET.top * MM_PER_TWIP,
} as const

/**
 * A label's print, as the template sets its three lines: the date 8 pt; the barcode as Libre Barcode 39
 * at 22 pt (narrow bar 0.03 em = 0.2328 mm, bars 0.59 em tall — measured from the font); the number
 * 24 pt bold (Arial in Word; Helvetica here — the same widths), with the template's spacing between them
 * (single-spaced lines). All three start at ONE left edge, and the whole block is centred on the
 * sticker, across and down. Positions in points from the sticker's top edge.
 */
const CAP = 0.718   // Helvetica's capital height, in em
const INK_TOP = 8 * CAP                      // the date's capitals, above its baseline
const INK = INK_TOP + 2.2 + 13 + 7.27 + 24 * CAP   // date, gap, bars, gap, the number's capitals
const MARGIN_Y = ((STICKERS.hMm / 25.4) * 72 - INK) / 2
export const LABEL = {
  dateSize: 8,
  dateBaseline: MARGIN_Y + INK_TOP,
  barNarrowMm: 0.2328,
  barTop: MARGIN_Y + INK_TOP + 2.2,
  barHeight: 13,
  numberSize: 24,
  numberBaseline: MARGIN_Y + INK,
} as const

/** Helvetica Bold's widths (1/1000 em) for what a Lot ID holds — so the page's preview and the PDF
 *  centre the number alike. */
const BOLD_W: Record<string, number> = {
  "0": 556, "1": 556, "2": 556, "3": 556, "4": 556, "5": 556, "6": 556, "7": 556, "8": 556, "9": 556,
  A: 722, B: 722, C: 722, D: 722, E: 667, F: 611, G: 778, H: 722, I: 278, J: 556, K: 722, L: 611, M: 833,
  N: 722, O: 778, P: 667, Q: 778, R: 722, S: 667, T: 611, U: 722, V: 667, W: 944, X: 667, Y: 667, Z: 611,
}
/** The number's width in points at `size` (Helvetica Bold). */
export const boldWidth = (text: string, size: number): number => ([...text].reduce((w, c) => w + (BOLD_W[c] ?? 722), 0) * size) / 1000

/**
 * Where a label's three lines go on its sticker: the bars' narrow width (mm), the number's size (pt) —
 * the template's, smaller only for a long code that wouldn't fit ROOM_PT — and the shared left edge
 * (pt from the sticker's left) that centres the wider of the two.
 */
export function labelFit(code: string): { narrowMm: number; numberSize: number; left: number } {
  const narrowMm = barNarrowFor(code)
  let numberSize: number = LABEL.numberSize
  while (numberSize > 10 && boldWidth(code, numberSize) > ROOM_PT) numberSize -= 0.5
  const widest = Math.max((code39Units(code) * narrowMm * 72) / 25.4, boldWidth(code, numberSize))
  return { narrowMm, numberSize, left: ((STICKERS.wMm * 72) / 25.4 - widest) / 2 }
}

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
  if (!r.sale) return "Type the sale number, for example F018."
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

/** The width (pt) a barcode or number may take — the sticker less the template's 1.22 mm text inset each
 *  side (35.67 mm), so centred, even a long code keeps 1.22 mm clear of both edges. */
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
