import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { PDFDocument, StandardFonts, PDFFont, PDFPage, rgb } from "pdf-lib"
import bwipjs from "bwip-js"

export const maxDuration = 60
export const runtime = "nodejs"

// GET /api/packers/barcode-sheet[?staffGroup=FULL_TIME|AGENCY|ALL]
//
// Returns a downloadable PDF with one barcode per packer (4 per A4 page).
// Mirrors the Vectis-branded sheet design: header bar with brand, then
// barcodes stacked vertically with the name underneath.

const PAGE_W   = 595.28   // A4 portrait
const PAGE_H   = 841.89
const MARGIN   = 36

// Per-barcode slot bounds. The autofit algorithm picks the largest slot
// that fits all (or N-per-page) of the barcodes — capped by MAX_SLOT so
// 2 packers don't render absurdly tall, and floored by MIN_SLOT so the
// barcode still scans cleanly. If N exceeds what fits at MIN_SLOT, we
// spill onto a fresh page rather than going below the readable floor.
const MAX_SLOT = 175  // pt — roomy 4-per-page layout when staff list is small
const MIN_SLOT = 95   // pt — minimum slot to keep a scannable barcode + label

export async function GET(req: NextRequest) {
  try {
    const session = await auth()
    if (!session) return NextResponse.json({ error: "Unauthorised" }, { status: 401 })

    const { searchParams } = req.nextUrl
    const staffGroup = searchParams.get("staffGroup") ?? "ALL"

    const where: any = { active: true }
    if (staffGroup === "FULL_TIME" || staffGroup === "AGENCY") where.staffGroup = staffGroup

    const packers = await prisma.packer.findMany({
      where,
      orderBy: [{ staffGroup: "asc" }, { sortOrder: "asc" }, { name: "asc" }],
    })

    if (packers.length === 0) {
      return NextResponse.json({ error: "No active packers to print" }, { status: 400 })
    }

    const pdfBytes = await buildPdf(packers.map(p => p.name), staffGroup)

    const groupLabel = staffGroup === "ALL" ? "all" : staffGroup.toLowerCase()
    const filename   = `vectis-packers-${groupLabel}-${new Date().toISOString().slice(0, 10)}.pdf`

    return new NextResponse(new Uint8Array(pdfBytes), {
      status: 200,
      headers: {
        "Content-Type":        "application/pdf",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Content-Length":      String(pdfBytes.length),
      },
    })
  } catch (e: any) {
    console.error("packers/barcode-sheet error:", e)
    return NextResponse.json({ error: e?.message ?? "PDF generation failed" }, { status: 500 })
  }
}

async function buildPdf(names: string[], staffGroup: string): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  doc.setTitle("Vectis Packers — Barcode Sheet")
  doc.setAuthor("Vectis Auctions")

  const helv  = await doc.embedFont(StandardFonts.Helvetica)
  const helvB = await doc.embedFont(StandardFonts.HelveticaBold)

  // Vectis blue from the brand sheet
  const brandBlue = rgb(0.18, 0.20, 0.45)

  // Vertical layout constants — same for every page so the autofit math
  // matches what we actually draw.
  const HEADER_HEIGHT = 120
  const usableTop     = PAGE_H - HEADER_HEIGHT - 20
  const usableBottom  = MARGIN + 20
  const usableH       = usableTop - usableBottom

  // How many barcodes fit on a page at the maximum slot size?
  const maxPerPageRoomy = Math.max(1, Math.floor(usableH / MIN_SLOT))

  // Try to fit everyone on one page first. If they wouldn't fit even at
  // MIN_SLOT, break into pages of maxPerPageRoomy.
  let perPage: number
  if (names.length <= maxPerPageRoomy) {
    perPage = names.length
  } else {
    perPage = maxPerPageRoomy
  }

  const chunks: string[][] = []
  for (let i = 0; i < names.length; i += perPage) chunks.push(names.slice(i, i + perPage))

  for (const pageNames of chunks) {
    const page = doc.addPage([PAGE_W, PAGE_H])
    drawHeader(page, helv, helvB, brandBlue)

    // Slot height for THIS page — equal share of usable space, capped at MAX_SLOT
    // so small groups don't get absurdly tall barcodes.
    const slotH = Math.min(MAX_SLOT, usableH / pageNames.length)

    // Centre the whole stack vertically if there's leftover space (small groups)
    const totalH      = slotH * pageNames.length
    const stackTop    = usableTop - (usableH - totalH) / 2

    for (let i = 0; i < pageNames.length; i++) {
      const name = pageNames[i]
      const centreY = stackTop - slotH * i - slotH / 2
      await drawBarcode(doc, page, name, centreY, slotH, helv, brandBlue)
    }
  }

  return await doc.save()
}

function drawHeader(page: PDFPage, helv: PDFFont, helvB: PDFFont, brandBlue: ReturnType<typeof rgb>) {
  // Wordmark — "Vectis" in big bold + "AUCTIONS · COLLECTABLES SPECIALISTS" beneath
  const titleSize = 42
  const titleText = "Vectis"
  const titleW    = helvB.widthOfTextAtSize(titleText, titleSize)
  const titleX    = (PAGE_W - titleW) / 2
  const titleY    = PAGE_H - MARGIN - titleSize

  page.drawText(titleText, { x: titleX, y: titleY, size: titleSize, font: helvB, color: brandBlue })

  // Underline strap
  const strapY = titleY - 6
  page.drawLine({
    start: { x: titleX + 6,             y: strapY },
    end:   { x: titleX + titleW - 6,    y: strapY },
    thickness: 1, color: rgb(0.65, 0.05, 0.07),  // brand red
  })

  // Subtitle line 1: AUCTIONS
  const sub1 = "AUCTIONS"
  const sub1Size = 8
  const sub1W = helv.widthOfTextAtSize(sub1, sub1Size)
  page.drawText(sub1, {
    x: (PAGE_W - sub1W) / 2,
    y: strapY - 12,
    size: sub1Size, font: helv, color: brandBlue,
  })
  // Subtitle line 2: COLLECTABLES SPECIALISTS
  const sub2 = "COLLECTABLES SPECIALISTS"
  const sub2Size = 8
  const sub2W = helv.widthOfTextAtSize(sub2, sub2Size)
  page.drawText(sub2, {
    x: (PAGE_W - sub2W) / 2,
    y: strapY - 24,
    size: sub2Size, font: helv, color: rgb(0.65, 0.05, 0.07),
  })

  // Full-width blue divider under the header (matches the reference)
  const dividerY = strapY - 38
  page.drawRectangle({
    x: MARGIN, y: dividerY,
    width: PAGE_W - MARGIN * 2, height: 4,
    color: brandBlue,
  })
}

async function drawBarcode(
  doc:      PDFDocument,
  page:     PDFPage,
  name:     string,
  centreY:  number,
  slotH:    number,
  helv:     PDFFont,
  brandBlue: ReturnType<typeof rgb>,
) {
  // Reserve roughly 25pt of the slot for the name label + padding;
  // the rest goes to the barcode image itself.
  const labelReserve  = 28
  const targetBcH     = Math.max(40, slotH - labelReserve)

  // Generate at a generous size — bwip-js will render bars proportional to
  // its own height setting. We then scale the embedded PNG to exactly the
  // target height in pdf-lib so quality stays high regardless of slot size.
  const pngBuf = await bwipjs.toBuffer({
    bcid:        "code128",       // standard staff/asset barcode
    text:        name,
    scale:       4,
    height:      20,              // bar height in mm — bwip-js source resolution
    includetext: false,           // we draw the name ourselves so we can colour-match
    backgroundcolor: "FFFFFF",
  })

  const png = await doc.embedPng(pngBuf)
  // Match target height; constrain width to page so very long names don't overflow
  const maxWidth = PAGE_W - MARGIN * 2 - 40
  let renderH = targetBcH
  let renderW = (png.width / png.height) * renderH
  if (renderW > maxWidth) {
    renderW = maxWidth
    renderH = (png.height / png.width) * renderW
  }

  const x = (PAGE_W - renderW) / 2
  const y = centreY - renderH / 2 + 8  // nudge up so name label sits in the slot too

  page.drawImage(png, { x, y, width: renderW, height: renderH })

  // Name underneath in Vectis blue — scale font slightly with slot size
  const nameSize = slotH < 120 ? 10 : 12
  const nameW = helv.widthOfTextAtSize(name, nameSize)
  page.drawText(name, {
    x: (PAGE_W - nameW) / 2,
    y: y - 16,
    size: nameSize, font: helv, color: brandBlue,
  })
}
