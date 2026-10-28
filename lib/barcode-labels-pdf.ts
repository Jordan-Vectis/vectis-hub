import { PDFDocument, PrintScaling, StandardFonts, rgb } from "pdf-lib"
import { LABEL, PER_SHEET, ROOM_PT, SHEET, STICKERS, barNarrowFor, barcodeOf, labelDate, type LabelRun } from "@/lib/barcode-labels"
import { code39Runs } from "@/lib/code39"

// Admin & Operations → Barcode Labels: the Lot ID labels as one A4 PDF for Avery L7651 sheets. SERVER
// ONLY (pdf-lib, like every PDF in the Hub — never pdfkit).
//
// Every label sits exactly where the old Word mail-merge template put it (lib/barcode-labels.ts SHEET
// and LABEL, in twips and points), so it prints onto the same sheets — at ACTUAL SIZE (100 %): the PDF
// asks the print box for no scaling (PrintScaling.None), and the page says so too. The barcode is drawn
// as vector bars (lib/code39.ts — the same Code 39 the template's Libre Barcode 39 font drew, at the
// same size), so it prints sharp on any printer with no font to install.

const A4_W = 595.28
const A4_H = 841.89
const PT_PER_MM = 72 / 25.4
const tw = (twips: number) => twips / 20

const INK = rgb(0, 0, 0)
const EDGE = rgb(0.65, 0.65, 0.65)

/**
 * The labels for `run`, in order — X160001 on the first label (or on label `startAt` of the first
 * sheet), across then down, as many sheets as it takes. `edges` (a test print on plain paper, held up
 * against a sheet) outlines the REAL stickers of an L7651 sheet in light grey — never on the labels.
 */
export async function buildBarcodeLabelsPdf(run: LabelRun, opts: { edges?: boolean } = {}): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  // The print box starts at "Actual size" rather than "Fit" — fitting shrinks the sheet off the stickers.
  doc.catalog.getOrCreateViewerPreferences().setPrintScaling(PrintScaling.None)
  const first = barcodeOf(run.sale, run.from), last = barcodeOf(run.sale, run.from + run.count - 1)
  doc.setTitle(`Lot ID labels ${first}${run.count > 1 ? ` to ${last}` : ""}`)
  doc.setAuthor("Vectis Auctions")
  doc.setCreator("Vectis Hub — Barcode Labels")
  const font = await doc.embedFont(StandardFonts.Helvetica)
  const bold = await doc.embedFont(StandardFonts.HelveticaBold)

  const date = labelDate(run.date)
  const outline = (page: ReturnType<typeof doc.addPage>) => {
    for (let r = 0; r < SHEET.rows; r++) {
      for (let c = 0; c < SHEET.cols; c++) {
        page.drawRectangle({
          x: (STICKERS.leftMm + c * STICKERS.pitchXMm) * PT_PER_MM,
          y: A4_H - (STICKERS.topMm + r * STICKERS.pitchYMm + STICKERS.hMm) * PT_PER_MM,
          width: STICKERS.wMm * PT_PER_MM, height: STICKERS.hMm * PT_PER_MM, borderColor: EDGE, borderWidth: 0.4,
        })
      }
    }
  }
  const newPage = () => { const p = doc.addPage([A4_W, A4_H]); if (opts.edges) outline(p); return p }
  let page = newPage()

  for (let i = 0; i < run.count; i++) {
    const slot = run.startAt - 1 + i
    if (i > 0 && slot % PER_SHEET === 0) page = newPage()
    const onSheet = slot % PER_SHEET
    const col = onSheet % SHEET.cols, row = Math.floor(onSheet / SHEET.cols)
    const left = tw(SHEET.left + col * (SHEET.labelW + SHEET.gap))
    const top = A4_H - tw(SHEET.top + row * SHEET.labelH)
    const code = barcodeOf(run.sale, run.from + i)

    // The date, inside the cell's padding.
    if (date) page.drawText(date, { x: left + tw(SHEET.padX), y: top - LABEL.dateBaseline, size: LABEL.dateSize, font, color: INK })

    // The bars — runs of narrow units, bar first — from the cell's edge, as the template's paragraph.
    const unit = barNarrowFor(code) * PT_PER_MM
    const barBottom = top - LABEL.barTop - LABEL.barHeight
    let bx = left + tw(SHEET.padX + LABEL.barIndent)
    code39Runs(code).forEach((units, k) => {
      const w = units * unit
      if (k % 2 === 0) page.drawRectangle({ x: bx, y: barBottom, width: w, height: LABEL.barHeight, color: INK })
      bx += w
    })

    // The number, big and bold — smaller only if a longer code wouldn't fit the label.
    let size: number = LABEL.numberSize
    while (size > 10 && bold.widthOfTextAtSize(code, size) > ROOM_PT) size -= 0.5
    page.drawText(code, { x: left + tw(SHEET.padX + LABEL.numberIndent), y: top - LABEL.numberBaseline, size, font: bold, color: INK })
  }
  return doc.save()
}
