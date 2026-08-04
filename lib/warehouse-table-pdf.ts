// Generic "print what's on screen" table PDF.
//
// Every BC Warehouse results table (Search by Location, Tote Data, Unsold
// Items, Sale Checklist) renders through the shared <FilterTable> component,
// which posts its VISIBLE rows — already filtered and sorted by the user — to
// /api/warehouse/table-pdf. This builder turns those plain strings into a
// Vectis-branded A4 sheet.
//
// Deliberately dumb: it does no lookups, no filtering and no sorting. The
// screen decides what is printed, so the PDF can never disagree with it.
// House pattern: pdf-lib only (pdfkit fails on Railway), sharp-rasterised logo,
// fixed column slots.
import { PDFDocument, StandardFonts, PDFFont, PDFPage, rgb, RGB } from "pdf-lib"
import { embedVectisLogo } from "@/lib/pdf-logo"

export type TablePdfColumn = {
  label: string
  // Relative weight for the column's share of the page width (default 1).
  width?: number
  align?: "left" | "right"
}

export type TablePdfInput = {
  title:        string
  subtitle?:    string
  columns:      TablePdfColumn[]
  rows:         string[][]
  orientation?: "portrait" | "landscape"
}

// ─── Layout ──────────────────────────────────────────────────────────────────
const A4_SHORT = 595.28
const A4_LONG  = 841.89
const MARGIN   = 32
const GUTTER   = 6
const FONT_SZ  = 8
const LINE_H   = 9.5
const MAX_LINES = 3   // cap a wrapped cell so one long description can't own a page
const ROW_PAD  = 5
const FOOTER_H = 24

const INK   = rgb(0, 0, 0)
const GREY  = rgb(0.30, 0.30, 0.30)
const MUTE  = rgb(0.50, 0.50, 0.50)
const LINE  = rgb(0.82, 0.82, 0.82)
const BAND  = rgb(0.955, 0.955, 0.955)

// pdf-lib's standard fonts are WinAnsi — anything outside it throws on draw.
function safeAscii(text: string): string {
  return (text ?? "")
    .replace(/[‘’‚‛]/g, "'")
    .replace(/[“”„‟]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/…/g, "...")
    .replace(/ /g, " ")
    .replace(/[^\x20-\x7E£€]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

function wrap(text: string, font: PDFFont, size: number, maxW: number): string[] {
  const safe = safeAscii(text)
  if (!safe) return [""]
  const words = safe.split(" ")
  const lines: string[] = []
  let line = ""
  for (const w of words) {
    const trial = line ? `${line} ${w}` : w
    if (font.widthOfTextAtSize(trial, size) <= maxW) { line = trial; continue }
    if (line) lines.push(line)
    if (font.widthOfTextAtSize(w, size) > maxW) {
      // A single unbreakable token (long barcode/ID) — split it character-wise.
      let chunk = ""
      for (const ch of w) {
        if (font.widthOfTextAtSize(chunk + ch, size) > maxW) { lines.push(chunk); chunk = ch }
        else chunk += ch
      }
      line = chunk
    } else {
      line = w
    }
  }
  if (line) lines.push(line)
  if (lines.length <= MAX_LINES) return lines
  const kept = lines.slice(0, MAX_LINES)
  let last = kept[MAX_LINES - 1]
  while (last.length > 1 && font.widthOfTextAtSize(last + "...", size) > maxW) last = last.slice(0, -1)
  kept[MAX_LINES - 1] = last + "..."
  return kept
}

export async function buildWarehouseTablePdf(input: TablePdfInput): Promise<Uint8Array> {
  const landscape = input.orientation
    ? input.orientation === "landscape"
    : input.columns.length > 5

  const pageW = landscape ? A4_LONG  : A4_SHORT
  const pageH = landscape ? A4_SHORT : A4_LONG
  const contentW = pageW - MARGIN * 2

  const doc = await PDFDocument.create()
  doc.setTitle(safeAscii(input.title) || "Vectis Warehouse")
  doc.setAuthor("Vectis Auctions")

  const helv  = await doc.embedFont(StandardFonts.Helvetica)
  const helvB = await doc.embedFont(StandardFonts.HelveticaBold)
  const logo  = await embedVectisLogo(doc)

  // Column slots — weights normalised across the usable width.
  const weights   = input.columns.map(c => Math.max(c.width ?? 1, 0.2))
  const totalWt   = weights.reduce((a, b) => a + b, 0) || 1
  const usableW   = contentW - GUTTER * Math.max(input.columns.length - 1, 0)
  const cols = input.columns.map((c, i) => ({
    label: safeAscii(c.label),
    align: c.align ?? "left",
    w:     (weights[i] / totalWt) * usableW,
    x:     0,
  }))
  let cursor = MARGIN
  for (const c of cols) { c.x = cursor; cursor += c.w + GUTTER }

  const printed = new Date().toLocaleString("en-GB", {
    day: "numeric", month: "long", year: "numeric",
    hour: "2-digit", minute: "2-digit", timeZone: "Europe/London",
  })

  let page = doc.addPage([pageW, pageH])
  let y = pageH - MARGIN

  // ── Branded header (first page only) ──
  const logoH = 42
  const logoW = logoH * (logo.width / logo.height)
  page.drawImage(logo, { x: MARGIN, y: y - logoH, width: logoW, height: logoH })
  page.drawText(safeAscii(input.title), { x: MARGIN, y: y - logoH - 14, size: 12, font: helvB, color: INK })
  if (input.subtitle) {
    page.drawText(safeAscii(input.subtitle), { x: MARGIN, y: y - logoH - 26, size: 8.5, font: helv, color: GREY })
  }
  drawRight(page, `Printed ${printed}`, pageW - MARGIN, y - 10, 8.5, helv, GREY)
  drawRight(page, `${input.rows.length.toLocaleString()} row${input.rows.length === 1 ? "" : "s"}`,
    pageW - MARGIN, y - 24, 11, helvB, INK)

  y -= logoH + (input.subtitle ? 34 : 22)
  page.drawLine({ start: { x: MARGIN, y }, end: { x: pageW - MARGIN, y }, thickness: 1.2, color: INK })
  y -= 13

  const drawHeader = () => {
    for (const c of cols) {
      const label = c.label.toUpperCase()
      if (c.align === "right") drawRight(page, label, c.x + c.w, y - 8, FONT_SZ, helvB, INK)
      else page.drawText(label, { x: c.x, y: y - 8, size: FONT_SZ, font: helvB, color: INK })
    }
    page.drawLine({ start: { x: MARGIN, y: y - 12 }, end: { x: pageW - MARGIN, y: y - 12 }, thickness: 0.8, color: INK })
    y -= 17
  }

  drawHeader()

  if (input.rows.length === 0) {
    page.drawText("Nothing to print - no rows matched the current filters.", {
      x: MARGIN, y: y - 10, size: 9, font: helv, color: GREY,
    })
  }

  input.rows.forEach((row, idx) => {
    const cells     = cols.map((c, i) => wrap(row[i] ?? "", helv, FONT_SZ, c.w))
    const lineCount = Math.max(...cells.map(l => l.length), 1)
    const rowH      = lineCount * LINE_H + ROW_PAD

    if (y - rowH < MARGIN + FOOTER_H) {
      page = doc.addPage([pageW, pageH])
      y = pageH - MARGIN
      drawHeader()
    }

    if (idx % 2 === 1) {
      page.drawRectangle({ x: MARGIN - 2, y: y - rowH + 2, width: contentW + 4, height: rowH, color: BAND })
    }

    cells.forEach((lines, i) => {
      const c = cols[i]
      lines.forEach((line, li) => {
        const ly = y - 8 - li * LINE_H
        if (c.align === "right") drawRight(page, line, c.x + c.w, ly, FONT_SZ, helv, INK)
        else page.drawText(line, { x: c.x, y: ly, size: FONT_SZ, font: helv, color: INK })
      })
    })

    y -= rowH
    page.drawLine({ start: { x: MARGIN, y }, end: { x: pageW - MARGIN, y }, thickness: 0.3, color: LINE })
  })

  // ── Footers (needs the final page count, so it runs last) ──
  const pages = doc.getPages()
  pages.forEach((p, i) => {
    p.drawText(safeAscii(input.title), { x: MARGIN, y: MARGIN - 14, size: 7.5, font: helv, color: MUTE })
    drawRight(p, `Page ${i + 1} of ${pages.length}`, pageW - MARGIN, MARGIN - 14, 7.5, helv, MUTE)
  })

  return await doc.save()
}

function drawRight(page: PDFPage, text: string, rightX: number, y: number, size: number, font: PDFFont, color: RGB) {
  const safe = safeAscii(text)
  const w = font.widthOfTextAtSize(safe, size)
  page.drawText(safe, { x: rightX - w, y, size, font, color })
}
