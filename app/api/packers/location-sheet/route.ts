import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { PDFDocument, StandardFonts, PDFFont, PDFPage, rgb } from "pdf-lib"
import bwipjs from "bwip-js"

export const maxDuration = 60
export const runtime = "nodejs"

// POST /api/packers/location-sheet
//
// Body: { locations: string[], arrow?: "none" | "left" | "right" }
//
// Returns a downloadable PDF with one barcode per location (6 per A4 page).
// No logo. Barcode on the LEFT, location code text on the RIGHT.
// Optional arrow drawn at the bottom of each row pointing left or right.

const PAGE_W = 595.28   // A4 portrait
const PAGE_H = 841.89
const MARGIN = 36

const PER_PAGE   = 6
const COL_GAP    = 24   // pt — gap between barcode and text columns
const TEXT_COL_W = 240  // pt — width of the right-side text column

type ArrowDir = "none" | "left" | "right"

export async function POST(req: NextRequest) {
  try {
    const session = await auth()
    if (!session) return NextResponse.json({ error: "Unauthorised" }, { status: 401 })

    const body = await req.json().catch(() => null)
    if (!body || !Array.isArray(body.locations)) {
      return NextResponse.json({ error: "locations array required" }, { status: 400 })
    }

    const locations: string[] = body.locations
      .map((l: unknown) => String(l).trim())
      .filter((l: string) => l.length > 0)

    if (locations.length === 0) {
      return NextResponse.json({ error: "No locations provided" }, { status: 400 })
    }

    const arrow: ArrowDir = body.arrow === "left" || body.arrow === "right" ? body.arrow : "none"

    const pdfBytes = await buildPdf(locations, arrow)

    const filename = `vectis-locations-${new Date().toISOString().slice(0, 10)}.pdf`

    return new NextResponse(new Uint8Array(pdfBytes), {
      status: 200,
      headers: {
        "Content-Type":        "application/pdf",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Content-Length":      String(pdfBytes.length),
      },
    })
  } catch (e: any) {
    console.error("packers/location-sheet error:", e)
    return NextResponse.json({ error: e?.message ?? "PDF generation failed" }, { status: 500 })
  }
}

async function buildPdf(locations: string[], arrow: ArrowDir): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  doc.setTitle("Vectis Location Barcodes")
  doc.setAuthor("Vectis Auctions")

  const helv  = await doc.embedFont(StandardFonts.Helvetica)
  const helvB = await doc.embedFont(StandardFonts.HelveticaBold)

  // Usable vertical area — full page height minus top/bottom margins
  const usableTop = PAGE_H - MARGIN
  const usableH   = usableTop - MARGIN

  // Fixed slot height — same for every page regardless of how many locations
  const slotH = usableH / PER_PAGE

  const chunks: string[][] = []
  for (let i = 0; i < locations.length; i += PER_PAGE) {
    chunks.push(locations.slice(i, i + PER_PAGE))
  }

  for (const pageLocations of chunks) {
    const page = doc.addPage([PAGE_W, PAGE_H])

    for (let i = 0; i < pageLocations.length; i++) {
      const loc    = pageLocations[i]
      const rowTop = usableTop - slotH * i
      await drawLocationRow(doc, page, loc, rowTop, slotH, helv, helvB, arrow)
    }
  }

  return await doc.save()
}

async function drawLocationRow(
  doc:      PDFDocument,
  page:     PDFPage,
  location: string,
  rowTop:   number,
  slotH:    number,
  helv:     PDFFont,
  helvB:    PDFFont,
  arrow:    ArrowDir,
) {
  const innerPad  = 8
  const targetBcH = Math.min(55, slotH - innerPad * 2)  // cap at ~packer-sheet size

  // Barcode column — left side
  const barcodeColX = MARGIN
  const barcodeColW = PAGE_W - MARGIN - COL_GAP - TEXT_COL_W - MARGIN

  // Generate Code 128 barcode as PNG
  const pngBuf = await bwipjs.toBuffer({
    bcid:            "code128",
    text:            location,
    scale:           4,
    height:          20,   // mm — source resolution
    includetext:     false,
    backgroundcolor: "FFFFFF",
  })

  const png = await doc.embedPng(pngBuf)

  // Scale to fit the slot height, constrain to barcode column width
  let renderH = targetBcH
  let renderW = (png.width / png.height) * renderH
  if (renderW > barcodeColW) {
    renderW = barcodeColW
    renderH = (png.height / png.width) * renderW
  }

  const centreY = rowTop - slotH / 2
  const bcY     = centreY - renderH / 2

  page.drawImage(png, { x: barcodeColX, y: bcY, width: renderW, height: renderH })

  // Text on the RIGHT — bold, black. Large base size, shrinks only if code is very long.
  const textColX = PAGE_W - MARGIN - TEXT_COL_W
  let   textSize = 54
  while (textSize > 10 && helvB.widthOfTextAtSize(location, textSize) > TEXT_COL_W) textSize -= 2

  const textY = centreY - textSize * 0.35
  page.drawText(location, {
    x:    textColX,
    y:    textY,
    size: textSize,
    font: helvB,
    color: rgb(0, 0, 0),
  })

  // Arrow — drawn near the bottom of the slot, inside the separator
  if (arrow !== "none") {
    const arrowY       = rowTop - slotH + 18   // 18pt above the separator line
    const shaftLen     = 60
    const headLen      = 14
    const headSpread   = 8
    const arrowThick   = 2.5
    const arrowColour  = rgb(0, 0, 0)

    if (arrow === "left") {
      const tipX  = MARGIN
      const tailX = MARGIN + shaftLen
      page.drawLine({ start: { x: tailX, y: arrowY }, end: { x: tipX, y: arrowY }, thickness: arrowThick, color: arrowColour })
      page.drawLine({ start: { x: tipX, y: arrowY }, end: { x: tipX + headLen, y: arrowY + headSpread }, thickness: arrowThick, color: arrowColour })
      page.drawLine({ start: { x: tipX, y: arrowY }, end: { x: tipX + headLen, y: arrowY - headSpread }, thickness: arrowThick, color: arrowColour })
    } else {
      const tipX  = PAGE_W - MARGIN
      const tailX = PAGE_W - MARGIN - shaftLen
      page.drawLine({ start: { x: tailX, y: arrowY }, end: { x: tipX, y: arrowY }, thickness: arrowThick, color: arrowColour })
      page.drawLine({ start: { x: tipX, y: arrowY }, end: { x: tipX - headLen, y: arrowY + headSpread }, thickness: arrowThick, color: arrowColour })
      page.drawLine({ start: { x: tipX, y: arrowY }, end: { x: tipX - headLen, y: arrowY - headSpread }, thickness: arrowThick, color: arrowColour })
    }
  }

  // Separator line between rows
  page.drawLine({
    start:     { x: MARGIN,          y: rowTop - slotH },
    end:       { x: PAGE_W - MARGIN, y: rowTop - slotH },
    thickness: 0.4,
    color:     rgb(0.85, 0.85, 0.88),
  })
}
