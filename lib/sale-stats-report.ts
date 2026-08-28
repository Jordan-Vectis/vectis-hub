// One definition of a Sale Statistics export, rendered two ways.
//
// ⚠ THE POINT OF THIS FILE. The screen builds ONE report object from exactly what it is showing —
// the active mode, the dates, the sale and category filters — and both the Excel export and the
// PDF read that same object. Defining the tables once per format is how a spreadsheet and a PDF
// of the same screen end up disagreeing, and the person reading them has no way to tell which is
// wrong. Add a column here, or in the builder that fills this in, and both exports gain it.
//
// Deliberately dependency-free: the client builds the object, and both export routes parse and
// render it.

/**
 * How a cell is written out. ⚠ The value itself is ALWAYS the raw number — pounds as 78650,
 * percentages as the ratio 0.523 — and the format decides how each destination shows it. That is
 * what lets the spreadsheet hold a real number that Excel formats as £78,650 and can still add up,
 * rather than the text "£78,650" which it cannot.
 */
export type CellFormat =
  | "text"
  | "money"        // £12,345
  | "money2"       // £12,345.67 — averages, where the pennies matter
  | "moneySigned"  // +£1,234 / -£1,234
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
   * Optional per-ROW format, parallel to `rows`, overriding the column format on every "auto" /
   * "autoSigned" column of that row.
   *
   * ⚠ This exists for the metric-comparison tables (Compare periods, and Best vs quietest), where
   * the table runs DOWN the metrics — Sale Value in pounds, Lots Sold as a count, Sell-through as
   * a percentage — so a single format per column is simply wrong. Its presence is also what marks
   * a table as mixed-unit, which is why the spreadsheet skips the totals row on one.
   */
  rowFormat?: CellFormat[]
}

/** The headline tiles, already formatted for display — they are prose, not arithmetic. */
export type ReportStat = { label: string; value: string; sub?: string }

export type SaleStatsReport = {
  title: string
  subtitle: string
  generatedAt: string   // ISO. ⚠ Stamped by the CLIENT — the server has no idea what "now" is
  generatedBy: string
  /** Spelled out on the summary sheet: a table with no record of what filtered it is a trap. */
  filters: { label: string; value: string }[]
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
 * The Excel number format for a cell.
 *
 * ⚠ These are what make the spreadsheet readable WITHOUT turning anything into text. The cell
 * still holds 78650 and 0.523; Excel shows £78,650 and 52.3%, =SUM works, and a pivot table sees
 * real numbers. The earlier export wrote 78650 with "(£)" bolted onto the header, which is what
 * made it look like a data dump.
 */
export function numberFormat(f: CellFormat): string | undefined {
  switch (f) {
    case "money":       return '£#,##0;[Red]-£#,##0'
    case "money2":      return '£#,##0.00;[Red]-£#,##0.00'
    case "moneySigned": return '"+"£#,##0;[Red]"-"£#,##0;£0'
    case "int":         return '#,##0'
    case "pct":         return '0.0%'
    case "pctSigned":   return '"+"0.0%;[Red]"-"0.0%;0.0%'
    default:            return undefined
  }
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

/** Money and counts add up; averages and percentages do not. Drives the totals row. */
export function isSummable(f: CellFormat): boolean {
  return f === "money" || f === "moneySigned" || f === "int"
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

// ─── Payload parsing ─────────────────────────────────────────────────────────
// Shared by both export routes. They TRUST the numbers — the screen did the aggregation, and
// re-running the streamed Business Central query per button press would double the load and let
// an export disagree with the screen it came from — but neither trusts the SHAPE. A malformed or
// enormous payload is rejected here, before pdf-lib or ExcelJS ever sees it.

const MAX_TABLES = 12
const MAX_ROWS   = 20000
const MAX_COLS   = 30
const MAX_STATS  = 24
const FORMATS: CellFormat[] = ["text", "money", "money2", "moneySigned", "int", "pct", "pctSigned", "auto", "autoSigned"]

const str = (v: unknown, max = 300) => (typeof v === "string" ? v.slice(0, max) : "")

function parseColumn(v: unknown): ReportColumn {
  const o = (v ?? {}) as Record<string, unknown>
  return { label: str(o.label, 60), format: FORMATS.includes(o.format as CellFormat) ? (o.format as CellFormat) : "text" }
}

function parseTable(v: unknown): ReportTable | null {
  const o = (v ?? {}) as Record<string, unknown>
  if (!Array.isArray(o.columns) || !Array.isArray(o.rows)) return null
  const columns = o.columns.slice(0, MAX_COLS).map(parseColumn)
  if (!columns.length) return null
  const rows = o.rows.slice(0, MAX_ROWS).map(r => {
    const arr = Array.isArray(r) ? r : []
    // Padded to the column count, so a short row can never shift cells left under the wrong header.
    return columns.map((_, i) => {
      const cell = arr[i]
      return typeof cell === "number" && isFinite(cell) ? cell : str(cell, 200)
    })
  })
  const rowFormat = Array.isArray(o.rowFormat)
    ? o.rowFormat.slice(0, MAX_ROWS).map(f => (FORMATS.includes(f as CellFormat) ? (f as CellFormat) : "text"))
    : undefined
  return { title: str(o.title, 120), note: str(o.note, 300) || undefined, columns, rows, rowFormat }
}

export function parseReportPayload(body: unknown): SaleStatsReport {
  const o = (body ?? {}) as Record<string, unknown>
  const pairs = (v: unknown, max: number) =>
    Array.isArray(v)
      ? v.slice(0, max).map(x => {
          const t = (x ?? {}) as Record<string, unknown>
          return { label: str(t.label, 40), value: str(t.value, 60), sub: str(t.sub, 60) || undefined }
        })
      : []
  return {
    title:       str(o.title, 120) || "Sale Statistics",
    subtitle:    str(o.subtitle, 300),
    generatedAt: str(o.generatedAt, 40) || new Date().toISOString(),
    generatedBy: str(o.generatedBy, 80),
    filters:     pairs(o.filters, 12).map(({ label, value }) => ({ label, value })),
    stats:       pairs(o.stats, MAX_STATS),
    tables:      Array.isArray(o.tables)
      ? o.tables.slice(0, MAX_TABLES).map(parseTable).filter((t): t is ReportTable => t !== null)
      : [],
  }
}
