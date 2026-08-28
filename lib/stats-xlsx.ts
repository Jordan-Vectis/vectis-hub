// Excel renderer for a SaleStatsReport — Tools → Sale Statistics, the ⬇ Excel button.
//
// ⚠ WHY EXCELJS AND NOT THE `xlsx` ALREADY IN THE PROJECT. SheetJS's community build cannot write
// cell styles — no bold, no fill, no borders — so an export through it is bare numbers under bare
// headers however carefully it is assembled (Jack, 2026-08-28: "that export is horrendous... make
// it super clean"). ExcelJS writes real formatting, and it runs on the SERVER, so none of it lands
// in the browser bundle.
//
// ⚠ EVERY NUMERIC CELL STAYS A NUMBER. The pounds are 78650 and the percentages are 0.523; the
// display comes from the cell's number format. That is the difference between a spreadsheet you
// can pivot, sort and =SUM, and a picture of one. Never write "£78,650" as text to make it look
// right — it looks right and behaves like a string.
import ExcelJS from "exceljs"
import {
  formatCell, cellFormat, numberFormat, isSummable, sheetName,
  type SaleStatsReport, type ReportTable,
} from "@/lib/sale-stats-report"

const TEAL      = "FF2AB4A6"
const HEAD_TEXT = "FFFFFFFF"
const BAND      = "FFF4F8F8"
const RULE      = "FFD9D9D9"
const MUTED     = "FF6B7280"
const INK       = "FF111827"

const TITLE_ROW = 1
const NOTE_ROW  = 2
const HEAD_ROW  = 4   // blank row 3 between the note and the table

/** Roughly how wide a column needs to be, measured on what will actually be displayed. */
function columnWidths(table: ReportTable): number[] {
  return table.columns.map((c, i) => {
    let widest = c.label.length
    table.rows.forEach((r, ri) => {
      widest = Math.max(widest, formatCell(r[i], cellFormat(table, ri, i)).length)
    })
    // Floor so short headers still have room to breathe; ceiling so one long lot name does not
    // push every other column off the screen.
    return Math.min(46, Math.max(11, widest + 3))
  })
}

function styleHeaderCell(cell: ExcelJS.Cell, rightAligned: boolean) {
  cell.font = { bold: true, size: 10, color: { argb: HEAD_TEXT } }
  cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: TEAL } }
  cell.alignment = { vertical: "middle", horizontal: rightAligned ? "right" : "left" }
  cell.border = { bottom: { style: "thin", color: { argb: RULE } } }
}

function addTableSheet(wb: ExcelJS.Workbook, table: ReportTable, taken: string[]) {
  const name = sheetName(table.title, taken)
  taken.push(name)

  const ws = wb.addWorksheet(name, {
    // The header row and the first column stay put — scrolling right through nineteen columns
    // with the sale code gone off the left is how people read the wrong row.
    views: [{ state: "frozen", xSplit: 1, ySplit: HEAD_ROW }],
  })

  const cols = table.columns
  const widths = columnWidths(table)
  ws.columns = widths.map(w => ({ width: w }))

  ws.mergeCells(TITLE_ROW, 1, TITLE_ROW, cols.length)
  const title = ws.getCell(TITLE_ROW, 1)
  title.value = table.title
  title.font  = { bold: true, size: 14, color: { argb: INK } }
  ws.getRow(TITLE_ROW).height = 22

  ws.mergeCells(NOTE_ROW, 1, NOTE_ROW, cols.length)
  const note = ws.getCell(NOTE_ROW, 1)
  note.value = table.note ?? ""
  note.font  = { italic: true, size: 9, color: { argb: MUTED } }

  const head = ws.getRow(HEAD_ROW)
  head.height = 20
  cols.forEach((c, i) => {
    const cell = head.getCell(i + 1)
    cell.value = c.label
    styleHeaderCell(cell, c.format !== "text")
  })

  table.rows.forEach((row, ri) => {
    const r = ws.getRow(HEAD_ROW + 1 + ri)
    cols.forEach((c, ci) => {
      const f = cellFormat(table, ri, ci)
      const cell = r.getCell(ci + 1)
      cell.value = row[ci] === "" ? null : row[ci]
      const fmt = numberFormat(f)
      if (fmt) cell.numFmt = fmt
      cell.alignment = { horizontal: c.format === "text" ? "left" : "right" }
      cell.font = { size: 10, color: { argb: INK } }
      // Banding rather than gridlines — quieter to read down, and it survives sorting.
      if (ri % 2 === 1) cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: BAND } }
    })
  })

  // ⚠ No totals row on a mixed-unit table. `rowFormat` marks the comparison tables, whose rows are
  // pounds, counts and percentages in the same column — a total there would be arithmetic nonsense
  // printed in bold, which is worse than no total at all.
  const lastDataRow = HEAD_ROW + table.rows.length
  if (table.rows.length > 1 && !table.rowFormat) {
    const totals = ws.getRow(lastDataRow + 1)
    totals.getCell(1).value = "Total"
    cols.forEach((c, ci) => {
      const cell = totals.getCell(ci + 1)
      // Averages and percentages are deliberately left blank — the sum of a column of averages
      // means nothing, and a blank cell says so more clearly than a wrong number.
      if (ci > 0 && isSummable(c.format)) {
        cell.value = table.rows.reduce((s, r) => s + (typeof r[ci] === "number" ? (r[ci] as number) : 0), 0)
        const fmt = numberFormat(c.format)
        if (fmt) cell.numFmt = fmt
      }
      cell.font = { bold: true, size: 10, color: { argb: INK } }
      cell.alignment = { horizontal: c.format === "text" ? "left" : "right" }
      cell.border = { top: { style: "thin", color: { argb: RULE } } }
    })
  }

  // Filter over the data only, so the totals row is never swept up by a filter or a sort.
  ws.autoFilter = {
    from: { row: HEAD_ROW, column: 1 },
    to:   { row: lastDataRow, column: cols.length },
  }
}

function addSummarySheet(wb: ExcelJS.Workbook, report: SaleStatsReport, taken: string[]) {
  const name = sheetName("Summary", taken)
  taken.push(name)
  const ws = wb.addWorksheet(name, { views: [{ state: "frozen", ySplit: 0 }] })
  ws.columns = [{ width: 30 }, { width: 22 }, { width: 46 }]

  let r = 1
  const heading = (text: string, size: number, bold = true, colour = INK) => {
    ws.mergeCells(r, 1, r, 3)
    const c = ws.getCell(r, 1)
    c.value = text
    c.font = { bold, size, color: { argb: colour } }
    ws.getRow(r).height = size + 8
    r++
  }
  const sectionHead = (a: string, b: string, c: string) => {
    const row = ws.getRow(r)
    row.height = 20
    ;[a, b, c].forEach((label, i) => {
      const cell = row.getCell(i + 1)
      cell.value = label
      styleHeaderCell(cell, false)
    })
    r++
  }

  heading(report.title, 16)
  heading(report.subtitle, 11, false, MUTED)
  const when = new Date(report.generatedAt)
  heading(
    `Exported ${isNaN(when.getTime()) ? "" : when.toLocaleString("en-GB", { dateStyle: "long", timeStyle: "short" })}` +
    (report.generatedBy ? ` by ${report.generatedBy}` : ""),
    9, false, MUTED,
  )
  r++

  // ⚠ The filters go IN the file, not just in the filename. A sheet of figures with no record of
  // what produced them gets forwarded, quoted and argued over — Jack, 2026-08-28: "it also needs
  // to follow the correct filters".
  if (report.filters.length) {
    sectionHead("Filters applied", "", "")
    for (const f of report.filters) {
      const row = ws.getRow(r)
      row.getCell(1).value = f.label
      row.getCell(1).font  = { size: 10, color: { argb: MUTED } }
      row.getCell(2).value = f.value
      row.getCell(2).font  = { size: 10, bold: true, color: { argb: INK } }
      ws.mergeCells(r, 2, r, 3)
      r++
    }
    r++
  }

  if (report.stats.length) {
    sectionHead("Figure", "Value", "Detail")
    report.stats.forEach((s, i) => {
      const row = ws.getRow(r)
      row.getCell(1).value = s.label
      row.getCell(2).value = s.value
      row.getCell(3).value = s.sub ?? ""
      row.getCell(1).font = { size: 10, color: { argb: INK } }
      row.getCell(2).font = { size: 11, bold: true, color: { argb: INK } }
      row.getCell(3).font = { size: 9, color: { argb: MUTED } }
      row.getCell(2).alignment = { horizontal: "right" }
      if (i % 2 === 1) {
        for (let c = 1; c <= 3; c++) row.getCell(c).fill = { type: "pattern", pattern: "solid", fgColor: { argb: BAND } }
      }
      r++
    })
    r++
  }

  const listed = report.tables.filter(t => t.rows.length)
  if (listed.length) {
    sectionHead("In this workbook", "Rows", "")
    for (const t of listed) {
      const row = ws.getRow(r)
      row.getCell(1).value = t.title
      row.getCell(1).font  = { size: 10, color: { argb: INK } }
      row.getCell(2).value = t.rows.length
      row.getCell(2).numFmt = "#,##0"
      row.getCell(2).alignment = { horizontal: "right" }
      row.getCell(2).font = { size: 10, color: { argb: MUTED } }
      r++
    }
  }
}

export async function buildSaleStatsXlsx(report: SaleStatsReport): Promise<Uint8Array> {
  const wb = new ExcelJS.Workbook()
  wb.creator = "Vectis Hub"
  const created = new Date(report.generatedAt)
  wb.created = isNaN(created.getTime()) ? new Date() : created

  const taken: string[] = []
  addSummarySheet(wb, report, taken)
  for (const t of report.tables) {
    if (!t.rows.length) continue
    addTableSheet(wb, t, taken)
  }

  const buf = await wb.xlsx.writeBuffer()
  return new Uint8Array(buf as ArrayBuffer)
}
