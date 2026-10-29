import { PDFDocument, PrintScaling, StandardFonts, rgb } from "pdf-lib"
import { LABEL, PER_SHEET, SHEET, STICKERS, barcodeOf, labelDate, labelFit, type LabelRun } from "@/lib/barcode-labels"
import { code39Runs } from "@/lib/code39"

// Admin & Operations → Barcode Labels: the Lot ID labels as one A4 PDF for Avery L7651 sheets. SERVER
// ONLY (pdf-lib, like every PDF in the Hub — never pdfkit).
//
// Each label's print is centred on its sticker (lib/barcode-labels.ts STICKERS and LABEL — the
// template's lines, sizes and spacing, one left edge), so it fits the sheet with room all round. It
// prints at ACTUAL SIZE (100 %): the PDF asks the print box for no scaling (PrintScaling.None), and the
// page says so too. The barcode is drawn as vector bars (lib/code39.ts — the same Code 39 the template's
// Libre Barcode 39 font drew, at the same size), so it prints sharp on any printer, no font to install.

const A4_W = 595.28
const A4_H = 841.89
const PT_PER_MM = 72 / 25.4

const INK = rgb(0, 0, 0)
const EDGE = rgb(0.65, 0.65, 0.65)

/** Where sticker `onSheet` (0–64, across then down) is: its left edge and top edge, in PDF points. */
function stickerAt(onSheet: number): { left: number; top: number } {
  const col = onSheet % SHEET.cols, row = Math.floor(onSheet / SHEET.cols)
  return {
    left: (STICKERS.leftMm + col * STICKERS.pitchXMm) * PT_PER_MM,
    top: A4_H - (STICKERS.topMm + row * STICKERS.pitchYMm) * PT_PER_MM,
  }
}

/**
 * The labels for `run`, in order — X160001 on the first label (or on label `startAt` of the first
 * sheet), across then down, as many sheets as it takes. `edges` (a test print on plain paper, held up
 * against a sheet) outlines every sticker in light grey — never on the labels.
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
  const W = STICKERS.wMm * PT_PER_MM, H = STICKERS.hMm * PT_PER_MM
  const newPage = () => {
    const p = doc.addPage([A4_W, A4_H])
    if (opts.edges) {
      for (let s = 0; s < PER_SHEET; s++) {
        const { left, top } = stickerAt(s)
        p.drawRectangle({ x: left, y: top - H, width: W, height: H, borderColor: EDGE, borderWidth: 0.4 })
      }
    }
    return p
  }
  let page = newPage()

  for (let i = 0; i < run.count; i++) {
    const slot = run.startAt - 1 + i
    if (i > 0 && slot % PER_SHEET === 0) page = newPage()
    const { left, top } = stickerAt(slot % PER_SHEET)
    const code = barcodeOf(run.sale, run.from + i)
    const fit = labelFit(code)
    const x = left + fit.left

    if (date) page.drawText(date, { x, y: top - LABEL.dateBaseline, size: LABEL.dateSize, font, color: INK })

    // The bars — runs of narrow units, bar first.
    const unit = fit.narrowMm * PT_PER_MM
    const barBottom = top - LABEL.barTop - LABEL.barHeight
    let bx = x
    code39Runs(code).forEach((units, k) => {
      const w = units * unit
      if (k % 2 === 0) page.drawRectangle({ x: bx, y: barBottom, width: w, height: LABEL.barHeight, color: INK })
      bx += w
    })

    page.drawText(code, { x, y: top - LABEL.numberBaseline, size: fit.numberSize, font: bold, color: INK })
  }
  return doc.save()
}
