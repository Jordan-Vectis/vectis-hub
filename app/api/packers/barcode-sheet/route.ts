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

// Horizontal row layout: name on left, barcode on right.
// 10 rows per page is the target — gives ~66pt per row after the header,
// which is enough for a comfortably scannable barcode + a clear name label.
const PER_PAGE  = 10
const MAX_SLOT  = 90   // pt — cap so small groups (3-4 packers) aren't absurdly tall
const NAME_COL_W = 200 // pt — width of the left name column
const COL_GAP    = 16  // pt — gap between name and barcode columns

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

  // Vertical layout constants — same for every page.
  const HEADER_HEIGHT = 120
  const usableTop     = PAGE_H - HEADER_HEIGHT - 20
  const usableBottom  = MARGIN + 20
  const usableH       = usableTop - usableBottom

  // Break into pages of 10
  const chunks: string[][] = []
  for (let i = 0; i < names.length; i += PER_PAGE) chunks.push(names.slice(i, i + PER_PAGE))

  for (const pageNames of chunks) {
    const page = doc.addPage([PAGE_W, PAGE_H])
    drawHeader(page, helv, helvB, brandBlue)

    // Slot height for THIS page — equal share of usable space.
    // Capped at MAX_SLOT so a small final page (e.g. 3 packers) doesn't render
    // each row ridiculously tall.
    const slotH = Math.min(MAX_SLOT, usableH / pageNames.length)

    // Centre the whole stack vertically if there's leftover space
    const totalH    = slotH * pageNames.length
    const stackTop  = usableTop - (usableH - totalH) / 2

    for (let i = 0; i < pageNames.length; i++) {
      const name = pageNames[i]
      const rowTop = stackTop - slotH * i
      await drawBarcodeRow(doc, page, name, rowTop, slotH, helv, helvB, brandBlue)
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

async function drawBarcodeRow(
  doc:      PDFDocument,
  page:     PDFPage,
  name:     string,
  rowTop:   number,
  slotH:    number,
  helv:     PDFFont,
  helvB:    PDFFont,
  brandBlue: ReturnType<typeof rgb>,
) {
  // Layout: NAME on left in a fixed-width column, BARCODE on the right
  // filling the remaining width. Both vertically centred within the slot.
  const innerPad   = 6
  const targetBcH  = Math.max(36, slotH - innerPad * 2)

  // Available width for the barcode after name column + gap
  const barcodeColX = MARGIN + NAME_COL_W + COL_GAP
  const barcodeColW = PAGE_W - MARGIN - barcodeColX

  // Generate the Code 128 barcode as PNG (high source resolution; we scale in pdf-lib)
  const pngBuf = await bwipjs.toBuffer({
    bcid:        "code128",
    text:        name,
    scale:       4,
    height:      20,        // mm — generous source resolution
    includetext: false,
    backgroundcolor: "FFFFFF",
  })

  const png = await doc.embedPng(pngBuf)
  // Scale to fit the slot height first, then constrain to the barcode column width
  let renderH = targetBcH
  let renderW = (png.width / png.height) * renderH
  if (renderW > barcodeColW) {
    renderW = barcodeColW
    renderH = (png.height / png.width) * renderW
  }

  const centreY = rowTop - slotH / 2
  const bcX     = barcodeColX + (barcodeColW - renderW) / 2  // centre within column
  const bcY     = centreY - renderH / 2

  page.drawImage(png, { x: bcX, y: bcY, width: renderW, height: renderH })

  // Name on the LEFT — bold, in Vectis blue. Font scales slightly with slot height.
  const baseFont   = slotH < 50 ? 11 : slotH < 70 ? 14 : 16
  // Auto-shrink to fit the column if the name is long
  let nameSize = baseFont
  while (nameSize > 8 && helvB.widthOfTextAtSize(name, nameSize) > NAME_COL_W) nameSize--

  const nameY = centreY - nameSize * 0.35   // baseline offset for visual centring
  page.drawText(name, {
    x: MARGIN, y: nameY,
    size: nameSize, font: helvB, color: brandBlue,
  })

  // Subtle separator line between rows
  page.drawLine({
    start: { x: MARGIN,             y: rowTop - slotH },
    end:   { x: PAGE_W - MARGIN,    y: rowTop - slotH },
    thickness: 0.4, color: rgb(0.85, 0.85, 0.88),
  })
}
