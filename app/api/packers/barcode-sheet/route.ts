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
const ROWS     = 4        // 4 barcodes per page (matches the reference design)

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

  const chunks: string[][] = []
  for (let i = 0; i < names.length; i += ROWS) chunks.push(names.slice(i, i + ROWS))

  for (const pageNames of chunks) {
    const page = doc.addPage([PAGE_W, PAGE_H])
    drawHeader(page, helv, helvB, brandBlue)

    // Space below header to bottom of page
    const headerHeight = 120
    const usableTop    = PAGE_H - headerHeight - 20
    const usableBottom = MARGIN + 20
    const usableH      = usableTop - usableBottom
    const slotH        = usableH / ROWS

    for (let i = 0; i < pageNames.length; i++) {
      const name = pageNames[i]
      const centreY = usableTop - slotH * i - slotH / 2
      await drawBarcode(doc, page, name, centreY, helv, brandBlue)
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
  helv:     PDFFont,
  brandBlue: ReturnType<typeof rgb>,
) {
  // Generate Code 128 barcode as PNG buffer
  const pngBuf = await bwipjs.toBuffer({
    bcid:        "code128",       // standard staff/asset barcode
    text:        name,
    scale:       3,
    height:      14,              // bar height in mm
    includetext: false,           // we draw the name ourselves so we can colour-match
    backgroundcolor: "FFFFFF",
  })

  const png = await doc.embedPng(pngBuf)
  const dims = png.scale(0.65)

  const x = (PAGE_W - dims.width) / 2
  const y = centreY - dims.height / 2

  page.drawImage(png, { x, y, width: dims.width, height: dims.height })

  // Name underneath in Vectis blue
  const nameSize = 11
  const nameW = helv.widthOfTextAtSize(name, nameSize)
  page.drawText(name, {
    x: (PAGE_W - nameW) / 2,
    y: y - 18,
    size: nameSize, font: helv, color: brandBlue,
  })
}
