// PDF renderer for a SaleStatsReport — Tools → Sale Statistics, the ⬇ PDF button.
//
// Deliberately GENERIC: it draws whatever tables the report object carries, so Single period,
// Compare periods and Best months all come through here, and a column added on the screen appears
// in the PDF without touching this file. A4 landscape to match the cataloguing reports, same
// branded header, server-side pdf-lib.
//
// ⚠ Charts are NOT drawn. The screen's bars are recharts SVG in the browser; redrawing them here
// would be a second implementation of the same picture, free to disagree with the one on screen.
// The tables under them hold the same numbers.
import { PDFDocument, PDFPage, PDFFont, PDFImage, StandardFonts, rgb } from "pdf-lib"
import { embedVectisLogo } from "@/lib/pdf-logo"
import { formatCell, cellFormat, type SaleStatsReport, type ReportTable } from "@/lib/sale-stats-report"

// ─── Layout ──────────────────────────────────────────────────────────────────
const PAGE_W = 841.89
const PAGE_H = 595.28
const MARGIN = 36
const CONTENT_W = PAGE_W - MARGIN * 2

const INK   = rgb(0, 0, 0)
const GREY  = rgb(0.30, 0.30, 0.30)
const MUTE  = rgb(0.50, 0.50, 0.50)
const LINE  = rgb(0.80, 0.80, 0.80)
const ZEBRA = rgb(0.972, 0.972, 0.972)
const TEAL  = rgb(0.165, 0.706, 0.651)
const RED   = rgb(0.79, 0.16, 0.16)
const GREEN = rgb(0.13, 0.63, 0.42)

const ROW_H  = 13
const FS     = 7.5   // table body
const FS_HEAD = 7.5

/**
 * ⚠ StandardFonts are WinAnsi-encoded and pdf-lib THROWS on any character it cannot encode — so a
 * single "−" (U+2212 MINUS SIGN, which the screen uses for negative money) would fail the entire
 * export rather than printing oddly. Everything drawn goes through here.
 */
function safe(s: string): string {
  return String(s)
    .replace(/[−‐-―]/g, "-")   // true minus and the whole dash family
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/…/g, "...")
    .replace(/[^\x20-\x7E\xA0-\xFF]/g, "")    // anything else (arrows, ticks, emoji) is dropped
}

/** Shorten to fit a column rather than letting text run under its neighbour. */
function fit(s: string, font: PDFFont, size: number, maxW: number): string {
  const t = safe(s)
  if (font.widthOfTextAtSize(t, size) <= maxW) return t
  let lo = 0, hi = t.length
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2)
    if (font.widthOfTextAtSize(t.slice(0, mid) + "...", size) <= maxW) lo = mid
    else hi = mid - 1
  }
  return t.slice(0, lo) + "..."
}

type Ctx = {
  doc: PDFDocument
  font: PDFFont
  bold: PDFFont
  logo: PDFImage | null
  report: SaleStatsReport
  pages: PDFPage[]
}

function newPage(ctx: Ctx): { page: PDFPage; y: number } {
  const page = ctx.doc.addPage([PAGE_W, PAGE_H])
  ctx.pages.push(page)
  let y = PAGE_H - MARGIN

  // Branded header, page 1 only — repeating the logo on every page of a 12-page table is noise.
  if (ctx.pages.length === 1) {
    if (ctx.logo) {
      const h = 22
      const w = (ctx.logo.width / ctx.logo.height) * h
      page.drawImage(ctx.logo, { x: MARGIN, y: y - h, width: w, height: h })
    }
    y -= 34
    page.drawText(fit(ctx.report.title, ctx.bold, 16, CONTENT_W), { x: MARGIN, y: y - 12, size: 16, font: ctx.bold, color: INK })
    y -= 18
    page.drawText(fit(ctx.report.subtitle, ctx.font, 9.5, CONTENT_W), { x: MARGIN, y: y - 10, size: 9.5, font: ctx.font, color: GREY })
    y -= 22
  } else {
    page.drawText(fit(ctx.report.title, ctx.bold, 9, CONTENT_W * 0.7), { x: MARGIN, y: y - 8, size: 9, font: ctx.bold, color: MUTE })
    y -= 20
  }
  return { page, y }
}

/** The headline tiles, laid out six to a row. */
function drawStats(ctx: Ctx, page: PDFPage, yStart: number): number {
  const stats = ctx.report.stats
  if (!stats.length) return yStart
  const PER_ROW = 6
  const GAP = 8
  const boxW = (CONTENT_W - GAP * (PER_ROW - 1)) / PER_ROW
  const boxH = 44
  let y = yStart

  for (let i = 0; i < stats.length; i += PER_ROW) {
    const row = stats.slice(i, i + PER_ROW)
    row.forEach((s, j) => {
      const x = MARGIN + j * (boxW + GAP)
      const first = i === 0 && j === 0
      page.drawRectangle({
        x, y: y - boxH, width: boxW, height: boxH,
        borderColor: first ? TEAL : LINE, borderWidth: first ? 1 : 0.5,
      })
      page.drawText(fit(s.label.toUpperCase(), ctx.font, 6, boxW - 10), { x: x + 5, y: y - 13, size: 6, font: ctx.font, color: MUTE })
      page.drawText(fit(s.value, ctx.bold, 13, boxW - 10), { x: x + 5, y: y - 29, size: 13, font: ctx.bold, color: first ? TEAL : INK })
      if (s.sub) page.drawText(fit(s.sub, ctx.font, 6, boxW - 10), { x: x + 5, y: y - 39, size: 6, font: ctx.font, color: MUTE })
    })
    y -= boxH + GAP
  }
  return y - 6
}

/** Signed columns are coloured the way the screen colours them — up is good, down is not. */
function cellColour(value: string | number, format: string): typeof INK {
  if (typeof value !== "number" || (format !== "moneySigned" && format !== "pctSigned")) return INK
  if (value > 0) return GREEN
  if (value < 0) return RED
  return GREY
}

function drawTable(ctx: Ctx, start: { page: PDFPage; y: number }, table: ReportTable): { page: PDFPage; y: number } {
  let { page, y } = start
  const cols = table.columns

  // Widths from the ACTUAL content, then scaled to fill the page — a table sized by its header
  // labels alone puts "1,234,567" under a column called "Sold".
  const raw = cols.map((c, i) => {
    let w = ctx.bold.widthOfTextAtSize(safe(c.label), FS_HEAD)
    table.rows.forEach((r, ri) => {
      w = Math.max(w, ctx.font.widthOfTextAtSize(safe(formatCell(r[i], cellFormat(table, ri, i))), FS))
    })
    return Math.min(w + 9, 190)
  })
  const sum = raw.reduce((s, w) => s + w, 0) || 1
  const widths = raw.map(w => (w / sum) * CONTENT_W)

  const titleH = 16
  const headH  = 14
  // Never strand a title at the very bottom with its table on the next page.
  if (y - (titleH + headH + ROW_H * 2) < MARGIN + 18) ({ page, y } = newPage(ctx))

  page.drawText(fit(table.title, ctx.bold, 10, CONTENT_W), { x: MARGIN, y: y - 10, size: 10, font: ctx.bold, color: TEAL })
  y -= titleH
  if (table.note) {
    page.drawText(fit(table.note, ctx.font, 7, CONTENT_W), { x: MARGIN, y: y - 7, size: 7, font: ctx.font, color: MUTE })
    y -= 11
  }

  const drawHead = () => {
    let x = MARGIN
    cols.forEach((c, i) => {
      const right = c.format !== "text"
      const label = fit(c.label, ctx.bold, FS_HEAD, widths[i] - 6)
      const tw = ctx.bold.widthOfTextAtSize(label, FS_HEAD)
      page.drawText(label, {
        x: right ? x + widths[i] - 4 - tw : x + 3,
        y: y - 9, size: FS_HEAD, font: ctx.bold, color: GREY,
      })
      x += widths[i]
    })
    page.drawLine({ start: { x: MARGIN, y: y - 12.5 }, end: { x: MARGIN + CONTENT_W, y: y - 12.5 }, thickness: 0.6, color: LINE })
    y -= headH
  }
  drawHead()

  table.rows.forEach((row, ri) => {
    if (y - ROW_H < MARGIN + 14) {
      ;({ page, y } = newPage(ctx))
      drawHead()
    }
    if (ri % 2 === 1) {
      page.drawRectangle({ x: MARGIN, y: y - ROW_H + 3, width: CONTENT_W, height: ROW_H, color: ZEBRA })
    }
    let x = MARGIN
    cols.forEach((c, i) => {
      const f     = cellFormat(table, ri, i)
      const text  = fit(formatCell(row[i], f), ctx.font, FS, widths[i] - 6)
      const right = c.format !== "text"
      const tw    = ctx.font.widthOfTextAtSize(text, FS)
      page.drawText(text, {
        x: right ? x + widths[i] - 4 - tw : x + 3,
        y: y - 6, size: FS, font: ctx.font, color: cellColour(row[i], f),
      })
      x += widths[i]
    })
    y -= ROW_H
  })

  return { page, y: y - 14 }
}

export async function buildSaleStatsPdf(report: SaleStatsReport): Promise<Uint8Array> {
  const doc  = await PDFDocument.create()
  const font = await doc.embedFont(StandardFonts.Helvetica)
  const bold = await doc.embedFont(StandardFonts.HelveticaBold)

  // ⚠ A missing or unrenderable logo must never lose the whole report — it is decoration.
  let logo: PDFImage | null = null
  try { logo = await embedVectisLogo(doc) } catch { logo = null }

  const ctx: Ctx = { doc, font, bold, logo, report, pages: [] }
  let cursor = newPage(ctx)
  cursor.y = drawStats(ctx, cursor.page, cursor.y)

  for (const t of report.tables) {
    if (!t.rows.length) continue
    cursor = drawTable(ctx, cursor, t)
  }

  // Footer on every page: where it came from and when, so a printout on a desk is not anonymous.
  const stamp = new Date(report.generatedAt)
  const when = isNaN(stamp.getTime()) ? "" : stamp.toLocaleString("en-GB", {
    day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Europe/London",
  })
  ctx.pages.forEach((p, i) => {
    const left = safe(`Vectis Hub - Sale Statistics${when ? ` - generated ${when}` : ""}${report.generatedBy ? ` by ${report.generatedBy}` : ""}`)
    p.drawText(fit(left, font, 6.5, CONTENT_W - 60), { x: MARGIN, y: MARGIN - 14, size: 6.5, font, color: MUTE })
    const num = `${i + 1} of ${ctx.pages.length}`
    p.drawText(num, { x: PAGE_W - MARGIN - font.widthOfTextAtSize(num, 6.5), y: MARGIN - 14, size: 6.5, font, color: MUTE })
  })

  return doc.save()
}
