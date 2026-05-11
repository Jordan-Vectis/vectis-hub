import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { getBCToken, bcFetchAll } from "@/lib/bc"
import { PDFDocument, StandardFonts, PDFFont, PDFPage, PDFImage, rgb } from "pdf-lib"
import { embedVectisLogo } from "@/lib/pdf-logo"

export const maxDuration = 60
export const runtime = "nodejs"

// GET /api/warehouse/collections-due/pdf?aisles=A39,A40
//
// Server-side PDF generator using pdf-lib (pure JS — no filesystem font
// reads, serverless-safe). Each aisle gets its own page(s) with its own
// header so different reports can be handed to different pickers.

type Item = {
  uniqueId:     string
  receiptNo:    string
  articleNo:    string
  barcode:      string
  description:  string
  location:     string
  collectionNo: string
  vendorName:   string
}

export async function GET(req: NextRequest) {
  try {
    const session = await auth()
    if (!session) return NextResponse.json({ error: "Unauthorised" }, { status: 401 })

    const token = await getBCToken()
    if (!token) return NextResponse.json({ error: "BC_NOT_CONNECTED" }, { status: 503 })

    const { searchParams } = req.nextUrl
    const aislesRaw = searchParams.get("aisles")?.trim() ?? ""
    const search    = searchParams.get("search")?.trim() ?? "COL"

    const aisleList = aislesRaw
      .split(/[,\s.;/|]+/)
      .map(s => s.trim().toUpperCase())
      .filter(Boolean)

    if (aisleList.length === 0) {
      return NextResponse.json({ error: "Provide at least one aisle (e.g. ?aisles=A39,A40)" }, { status: 400 })
    }

    // Parallel per-aisle queries — combined OR filters time out in BC
    const escSearch = search.replace(/'/g, "''")
    const settled = await Promise.allSettled(aisleList.map(a =>
      bcFetchAll(
        token,
        "Receipt_Lines_Excel",
        `startswith(EVA_ArticleLocationCode, '${a}') and contains(EVA_CollectionNo, '${escSearch}')`,
        undefined,
        500,
      )
    ))
    const rows = settled.flatMap(r => r.status === "fulfilled" ? r.value : [])

    const items: Item[] = rows.map(r => ({
      uniqueId:     String(r.EVA_UniqueID ?? ""),
      receiptNo:    String(r.EVA_ReceiptNo ?? ""),
      articleNo:    r.EVA_ArticleNo != null ? String(r.EVA_ArticleNo) : "",
      barcode:      String(r.PTE_InternalBarcode ?? ""),
      description:  String(r.EVA_ShortDescription ?? ""),
      location:     String(r.EVA_ArticleLocationCode ?? ""),
      collectionNo: String(r.EVA_CollectionNo ?? ""),
      vendorName:   String(r.EVA_VendorName ?? ""),
    })).sort((a, b) => {
      const locCmp = a.location.localeCompare(b.location)
      if (locCmp !== 0) return locCmp
      return a.collectionNo.localeCompare(b.collectionNo)
    })

    // Group by aisle
    const groups = new Map<string, Item[]>()
    for (const a of aisleList) groups.set(a, [])
    const other: Item[] = []
    for (const it of items) {
      const matched = aisleList.find(a => it.location.toUpperCase().startsWith(a))
      if (matched) groups.get(matched)!.push(it)
      else         other.push(it)
    }
    const aisleGroups: { aisle: string; items: Item[] }[] = []
    for (const a of aisleList) {
      const list = groups.get(a)!
      if (list.length > 0) aisleGroups.push({ aisle: a, items: list })
    }
    if (other.length > 0) aisleGroups.push({ aisle: "Other", items: other })

    const pdfBytes = await buildPdf(aisleGroups)

    const filename = `collections-due-${aisleList.join("-")}-${new Date().toISOString().slice(0, 10)}.pdf`
    return new NextResponse(new Uint8Array(pdfBytes), {
      status: 200,
      headers: {
        "Content-Type":        "application/pdf",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Content-Length":      String(pdfBytes.length),
      },
    })
  } catch (e: any) {
    console.error("collections-due/pdf error:", e)
    return NextResponse.json({ error: e?.message ?? "PDF generation failed" }, { status: 500 })
  }
}

// ─── PDF builder (pdf-lib) ──────────────────────────────────────────────────

// A4 portrait dimensions in points
const PAGE_W   = 595.28
const PAGE_H   = 841.89
const MARGIN   = 36
const CONTENT_W = PAGE_W - MARGIN * 2

// Column layout (x positions are left edges, w is width)
const COL = {
  location:     { x: MARGIN,             w: 60  },
  barcode:      { x: MARGIN + 64,        w: 60  },
  description:  { x: MARGIN + 128,       w: 240 },
  collectionNo: { x: MARGIN + 372,       w: 105 },
  tick:         { x: MARGIN + 481,       w: 18  },
}

async function buildPdf(aisleGroups: { aisle: string; items: Item[] }[]): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  doc.setTitle("Collections Due")
  doc.setAuthor("Vectis Auctions")

  const helv  = await doc.embedFont(StandardFonts.Helvetica)
  const helvB = await doc.embedFont(StandardFonts.HelveticaBold)
  const mono  = await doc.embedFont(StandardFonts.Courier)
  const logo  = await embedVectisLogo(doc)

  const printedDate = new Date().toLocaleDateString("en-GB", {
    weekday: "short", day: "numeric", month: "long", year: "numeric",
  })

  if (aisleGroups.length === 0) {
    const page = doc.addPage([PAGE_W, PAGE_H])
    page.drawText("No matching items found.", {
      x: MARGIN, y: PAGE_H - MARGIN - 20,
      size: 12, font: helv, color: rgb(0, 0, 0),
    })
  } else {
    for (const group of aisleGroups) {
      renderAisleReport(doc, group.aisle, group.items, printedDate, { helv, helvB, mono, logo })
    }
  }

  return await doc.save()
}

type Fonts = { helv: PDFFont; helvB: PDFFont; mono: PDFFont; logo: PDFImage }

function renderAisleReport(
  doc:         PDFDocument,
  aisle:       string,
  items:       Item[],
  printedDate: string,
  fonts:       Fonts,
) {
  const black = rgb(0, 0, 0)
  const grey  = rgb(0.27, 0.27, 0.27)
  const lite  = rgb(0.8, 0.8, 0.8)

  let page = doc.addPage([PAGE_W, PAGE_H])
  // y starts at the top of the printable area and decreases as we draw down
  let y = PAGE_H - MARGIN

  // ── Logo header (left), metadata (right) ─────────────────
  const logoH = 48
  const logoW = logoH * (fonts.logo.width / fonts.logo.height)
  page.drawImage(fonts.logo, { x: MARGIN, y: y - logoH, width: logoW, height: logoH })

  page.drawText("Collections Due", {
    x: MARGIN, y: y - logoH - 14, size: 10, font: fonts.helv, color: grey,
  })

  // Right-aligned date / aisle / count
  drawRight(page, `Printed ${printedDate}`,                     PAGE_W - MARGIN, y - 10, 9,  fonts.helv,  grey)
  drawRight(page, `Aisle: ${aisle}`,                            PAGE_W - MARGIN, y - 24, 12, fonts.helvB, black)
  drawRight(page, `${items.length} item${items.length === 1 ? "" : "s"}`, PAGE_W - MARGIN, y - 40, 9, fonts.helv, grey)

  y = y - logoH - 28
  page.drawLine({
    start: { x: MARGIN,              y },
    end:   { x: PAGE_W - MARGIN,     y },
    thickness: 1.5, color: black,
  })
  y -= 14

  // ── Table header ────────────────────────────────────────
  drawTableHeader(page, y, fonts.helvB)
  y -= 18

  // ── Table rows ──────────────────────────────────────────
  for (const it of items) {
    const descLines = wrapText(it.description, fonts.helv, 8, COL.description.w - 4)
    const rowHeight = Math.max(descLines.length * 10, 12) + 4

    // Start a new page if this row won't fit
    if (y - rowHeight < MARGIN + 24) {
      page = doc.addPage([PAGE_W, PAGE_H])
      y = PAGE_H - MARGIN
      drawTableHeader(page, y, fonts.helvB)
      y -= 18
    }

    page.drawText(safeAscii(it.location),     { x: COL.location.x,     y: y - 8, size: 8, font: fonts.mono, color: black })
    page.drawText(safeAscii(it.barcode),      { x: COL.barcode.x,      y: y - 8, size: 8, font: fonts.mono, color: black })
    descLines.forEach((line, i) => {
      page.drawText(line, { x: COL.description.x, y: y - 8 - i * 10, size: 8, font: fonts.helv, color: black })
    })
    page.drawText(safeAscii(it.collectionNo), { x: COL.collectionNo.x, y: y - 8, size: 8, font: fonts.mono, color: black })
    // Tickbox
    page.drawRectangle({
      x: COL.tick.x + 4, y: y - 11, width: 9, height: 9,
      borderColor: black, borderWidth: 0.6,
    })

    y -= rowHeight

    // Light separator
    page.drawLine({
      start: { x: MARGIN,          y },
      end:   { x: PAGE_W - MARGIN, y },
      thickness: 0.3, color: lite,
    })
  }

  // ── Total row ───────────────────────────────────────────
  if (y - 24 < MARGIN) {
    page = doc.addPage([PAGE_W, PAGE_H])
    y = PAGE_H - MARGIN
  }
  y -= 6
  page.drawLine({
    start: { x: MARGIN,          y },
    end:   { x: PAGE_W - MARGIN, y },
    thickness: 1.2, color: black,
  })
  page.drawText(`Aisle ${aisle} total: ${items.length} item${items.length === 1 ? "" : "s"}`, {
    x: MARGIN, y: y - 12, size: 9, font: fonts.helvB, color: black,
  })
}

function drawTableHeader(page: PDFPage, y: number, font: PDFFont) {
  const black = rgb(0, 0, 0)
  page.drawText("LOCATION",       { x: COL.location.x,     y: y - 8, size: 8, font, color: black })
  page.drawText("BARCODE",        { x: COL.barcode.x,      y: y - 8, size: 8, font, color: black })
  page.drawText("DESCRIPTION",    { x: COL.description.x,  y: y - 8, size: 8, font, color: black })
  page.drawText("COLLECTION NO.", { x: COL.collectionNo.x, y: y - 8, size: 8, font, color: black })
  page.drawText("DONE",           { x: COL.tick.x - 2,     y: y - 8, size: 8, font, color: black })
  page.drawLine({
    start: { x: MARGIN,          y: y - 12 },
    end:   { x: PAGE_W - MARGIN, y: y - 12 },
    thickness: 0.8, color: black,
  })
}

function drawRight(page: PDFPage, text: string, rightX: number, y: number, size: number, font: PDFFont, color: any) {
  const safe = safeAscii(text)
  const w = font.widthOfTextAtSize(safe, size)
  page.drawText(safe, { x: rightX - w, y, size, font, color })
}

// Strip anything pdf-lib's WinAnsi encoder can't handle. Used for short
// fields (location codes, barcodes, totals lines) where wrapText overhead
// isn't needed but the same encoding rules apply.
function safeAscii(text: string): string {
  return text
    .replace(/[‘’‚‛]/g, "'")
    .replace(/[“”„‟]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/…/g, "...")
    .replace(/ /g, " ")
    .replace(/[^\x20-\x7E£€]/g, "")
}

// Word-wrap text to fit a maximum width given a specific font and size.
// pdf-lib doesn't auto-wrap, so we do it manually.
function wrapText(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  // pdf-lib's standard fonts use WinAnsi which only encodes a subset of
  // characters. Replace common Unicode lookalikes with ASCII equivalents,
  // then strip anything outside printable ASCII to be safe.
  const safe = text
    .replace(/[‘’‚‛]/g, "'")  // smart single quotes
    .replace(/[“”„‟]/g, '"')  // smart double quotes
    .replace(/[–—]/g, "-")              // en-dash / em-dash
    .replace(/…/g, "...")                    // ellipsis
    .replace(/ /g, " ")                      // non-breaking space
    .replace(/[^\x20-\x7E£€]/g, " ")              // strip anything else not WinAnsi-safe
    .replace(/\s+/g, " ")
    .trim()
  if (!safe) return [""]

  const words = safe.split(" ")
  const lines: string[] = []
  let line = ""
  for (const w of words) {
    const trial = line ? `${line} ${w}` : w
    if (font.widthOfTextAtSize(trial, size) <= maxWidth) {
      line = trial
    } else {
      if (line) lines.push(line)
      // If a single word is wider than maxWidth, hard-truncate it
      if (font.widthOfTextAtSize(w, size) > maxWidth) {
        line = ""
        let chunk = ""
        for (const ch of w) {
          if (font.widthOfTextAtSize(chunk + ch, size) > maxWidth) {
            lines.push(chunk)
            chunk = ch
          } else {
            chunk += ch
          }
        }
        line = chunk
      } else {
        line = w
      }
    }
  }
  if (line) lines.push(line)
  return lines.length > 0 ? lines : [""]
}
