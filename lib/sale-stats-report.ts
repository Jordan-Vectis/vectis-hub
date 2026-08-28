// One definition of a Sale Statistics export, rendered two ways.
//
// ⚠ THE POINT OF THIS FILE. The screen builds ONE report object from exactly what it is showing —
// the active mode, the dates, the sale and category filters — and both the Excel export and the
// PDF read that same object. Defining the tables once per format is how a spreadsheet and a PDF
// of the same screen end up disagreeing, and the person reading them has no way to tell which is
// wrong. Add a column here, or in the builder that fills this in, and both exports gain it.
//
// Deliberately dependency-free so the client (Excel, in the browser) and the server (pdf-lib, in
// the PDF route) can both import it.

/** How a cell is written out. The value itself is always the RAW number. */
export type CellFormat =
  | "text"
  | "money"        // £12,345
  | "money2"       // £12,345.67 — averages, where the pennies matter
  | "moneySigned"  // +£1,234 / −£1,234
  | "int"          // 12,345
  | "pct"          // 52.3%   (stored as 0.523)
  | "pctSigned"    // +8.1%   (stored as 0.081)
  // ⚠ The two below take their format from the ROW (see `rowFormat`), for the comparison tables
  // that run down the metrics — pounds, counts and percentages in one column. "autoSigned" is the
  // difference column: it uses the row's unit but always shows the sign, because a difference
  // whose minus can be missed is worse than no difference at all.
  | "auto"
  | "autoSigned"

export type ReportColumn = { label: string; format: CellFormat }

export type ReportTable = {
  title: string
  note?: string
  columns: ReportColumn[]
  /** Raw values — numbers stay numbers so the spreadsheet can add them up. */
  rows: (string | number)[][]
  /**
   * Optional per-ROW format, parallel to `rows`, overriding the column format on every non-text
   * column of that row.
   *
   * ⚠ This exists for the metric-comparison tables (Compare periods, and Best vs quietest), where
   * the table runs DOWN the metrics — Sale Value in pounds, Lots Sold as a count, Sell-through as
   * a percentage — so a single format per column is simply wrong. Without it those tables would
   * have to be written out as pre-formatted text, and the spreadsheet would lose every number.
   */
  rowFormat?: CellFormat[]
}

const SIGNED_OF: Partial<Record<CellFormat, CellFormat>> = {
  money: "moneySigned", money2: "moneySigned", moneySigned: "moneySigned",
  int: "int", pct: "pctSigned", pctSigned: "pctSigned",
}

/**
 * The format for one cell. Only "auto" / "autoSigned" columns defer to the row — every other
 * column keeps its own, so a percentage-change column stays a percentage on a row of pounds.
 */
export function cellFormat(table: ReportTable, rowIndex: number, colIndex: number): CellFormat {
  const col = table.columns[colIndex]?.format ?? "text"
  if (col !== "auto" && col !== "autoSigned") return col
  const row = table.rowFormat?.[rowIndex] ?? "text"
  return col === "auto" ? row : (SIGNED_OF[row] ?? row)
}

/** The headline tiles, already formatted for display — they are prose, not arithmetic. */
export type ReportStat = { label: string; value: string; sub?: string }

export type SaleStatsReport = {
  title: string
  subtitle: string
  generatedAt: string   // ISO. ⚠ Stamped by the CLIENT — the server has no idea what "now" is
  generatedBy: string   // for the footer, so a printed page says where it came from
  stats: ReportStat[]
  tables: ReportTable[]
}

const money  = (n: number) => "£" + Math.round(n).toLocaleString("en-GB")
const money2 = (n: number) => "£" + n.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const int    = (n: number) => Math.round(n).toLocaleString("en-GB")

/** For the PDF, where every cell is text on a page. */
export function formatCell(v: string | number, f: CellFormat): string {
  if (typeof v === "string") return v
  if (!isFinite(v)) return "—"
  switch (f) {
    case "money":       return money(v)
    case "money2":      return money2(v)
    case "moneySigned": return (v >= 0 ? "+" : "−") + money(Math.abs(v))
    case "int":         return int(v)
    case "pct":         return (v * 100).toFixed(1) + "%"
    case "pctSigned":   return (v >= 0 ? "+" : "") + (v * 100).toFixed(1) + "%"
    default:            return String(v)
  }
}

/**
 * For the spreadsheet, where a number must stay a number.
 *
 * ⚠ Percentages are multiplied out to 52.3 rather than left at 0.523, and the column header says
 * "(%)". A bare 0.523 in a spreadsheet reads as fifty-two pence to most people, and typing =SUM
 * over a column of ratios gives an answer that means nothing either way.
 */
export function excelValue(v: string | number, f: CellFormat): string | number {
  if (typeof v === "string") return v
  if (!isFinite(v)) return ""
  if (f === "pct" || f === "pctSigned") return Math.round(v * 1000) / 10
  if (f === "money2") return Math.round(v * 100) / 100
  if (f === "money" || f === "moneySigned") return Math.round(v)
  return v
}

/** "Sale Value" → "Sale Value (£)", so a bare number in a cell is never ambiguous. */
export function excelHeader(c: ReportColumn): string {
  if (c.format === "money" || c.format === "money2" || c.format === "moneySigned") return `${c.label} (£)`
  if (c.format === "pct" || c.format === "pctSigned") return `${c.label} (%)`
  return c.label
}

/**
 * Excel sheet names: 31 characters, and none of : \ / ? * [ ]. Excel refuses to open a workbook
 * that breaks either rule rather than repairing it, so this is not cosmetic.
 */
export function sheetName(title: string, taken: string[] = []): string {
  const base = (title.replace(/[:\\/?*[\]]/g, "-").trim() || "Sheet").slice(0, 31)
  if (!taken.includes(base)) return base
  for (let n = 2; n < 100; n++) {
    const candidate = `${base.slice(0, 31 - String(n).length - 1)} ${n}`
    if (!taken.includes(candidate)) return candidate
  }
  return base.slice(0, 29) + "~"
}

/** Filesystem-safe, and never empty. Shared so the .xlsx and .pdf of one report match. */
export function reportFilename(report: SaleStatsReport, ext: "xlsx" | "pdf"): string {
  const stamp = report.generatedAt.slice(0, 10)
  const base  = `${report.title} ${report.subtitle}`
    .replace(/[^A-Za-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 90)
  return `${base || "Sale_Statistics"}_${stamp}.${ext}`
}
