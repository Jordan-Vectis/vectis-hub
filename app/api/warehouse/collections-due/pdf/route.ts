import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { getBCToken, bcFetchAll } from "@/lib/bc"
import PDFDocument from "pdfkit"

export const maxDuration = 60
export const runtime = "nodejs"

// GET /api/warehouse/collections-due/pdf?aisles=A39,A40
//
// Server-side PDF generator. Each aisle gets its own page (or pages) with
// its own header so different reports can be handed to different pickers.
// Returns application/pdf as a downloadable file.

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
      .split(/[,\s]+/)
      .map(s => s.trim().toUpperCase())
      .filter(Boolean)

    if (aisleList.length === 0) {
      return NextResponse.json({ error: "Provide at least one aisle (e.g. ?aisles=A39,A40)" }, { status: 400 })
    }

    // Same query as the JSON endpoint
    const aisleFilter = aisleList
      .map(a => `startswith(EVA_ArticleLocationCode, '${a}')`)
      .join(" or ")
    const filter = `(${aisleFilter}) and contains(EVA_CollectionNo, '${search.replace(/'/g, "''")}')`

    const rows = await bcFetchAll(token, "Receipt_Lines_Excel", filter, undefined, 500)

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

    // Build the PDF
    const pdfBuffer = await buildPdf(aisleGroups)

    const filename = `collections-due-${aisleList.join("-")}-${new Date().toISOString().slice(0, 10)}.pdf`
    return new NextResponse(new Uint8Array(pdfBuffer), {
      status: 200,
      headers: {
        "Content-Type":        "application/pdf",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Content-Length":      String(pdfBuffer.length),
      },
    })
  } catch (e: any) {
    console.error("collections-due/pdf error:", e)
    return NextResponse.json({ error: e?.message ?? "PDF generation failed" }, { status: 500 })
  }
}

// ─── PDF builder ─────────────────────────────────────────────────────────────

function buildPdf(aisleGroups: { aisle: string; items: Item[] }[]): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({
        size:    "A4",
        margins: { top: 36, bottom: 36, left: 36, right: 36 },
        info:    { Title: "Collections Due", Author: "Vectis Auctions" },
      })

      const chunks: Buffer[] = []
      doc.on("data",  (c: Buffer) => chunks.push(c))
      doc.on("end",   ()          => resolve(Buffer.concat(chunks)))
      doc.on("error", reject)

      const printedDate = new Date().toLocaleDateString("en-GB", {
        weekday: "short", day: "numeric", month: "long", year: "numeric",
      })

      aisleGroups.forEach((group, idx) => {
        if (idx > 0) doc.addPage()
        renderAisleReport(doc, group.aisle, group.items, printedDate)
      })

      // No groups → empty report
      if (aisleGroups.length === 0) {
        doc.fontSize(14).text("No matching items found.", { align: "center" })
      }

      doc.end()
    } catch (e) {
      reject(e)
    }
  })
}

// Column layout for the items table
const COL = {
  location:     { x: 36,  width: 60  },
  barcode:      { x: 100, width: 60  },
  description:  { x: 164, width: 240 },
  collectionNo: { x: 408, width: 100 },
  tick:         { x: 512, width: 22  },
}

function renderAisleReport(doc: PDFKit.PDFDocument, aisle: string, items: Item[], printedDate: string) {
  const pageWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right

  // Header
  doc.font("Helvetica-Bold").fontSize(16)
     .text("Vectis Auctions — Collections Due", doc.page.margins.left, doc.page.margins.top)
  doc.font("Helvetica").fontSize(9).fillColor("#444")
     .text("Items with a collection docket awaiting dispatch")

  doc.font("Helvetica").fontSize(9).fillColor("#444")
  const headerRightY = doc.page.margins.top
  doc.text(`Printed ${printedDate}`,            doc.page.margins.left, headerRightY, { align: "right", width: pageWidth })
  doc.text(`Aisle: ${aisle}`,                   doc.page.margins.left, headerRightY + 12, { align: "right", width: pageWidth })
  doc.text(`${items.length} item${items.length === 1 ? "" : "s"}`, doc.page.margins.left, headerRightY + 24, { align: "right", width: pageWidth })

  doc.fillColor("#000")

  // Move below header
  let y = doc.page.margins.top + 50
  doc.moveTo(doc.page.margins.left, y).lineTo(doc.page.width - doc.page.margins.right, y).lineWidth(1.5).stroke()
  y += 8

  // Table header row
  drawTableHeader(doc, y)
  y += 18

  doc.font("Helvetica").fontSize(8).fillColor("#000")

  for (const it of items) {
    // Calculate row height (description can wrap)
    const descHeight = doc.heightOfString(it.description, { width: COL.description.width })
    const rowHeight  = Math.max(descHeight, 12) + 6

    // Page break if row won't fit
    if (y + rowHeight > doc.page.height - doc.page.margins.bottom - 24) {
      doc.addPage()
      y = doc.page.margins.top
      drawTableHeader(doc, y)
      y += 18
      doc.font("Helvetica").fontSize(8).fillColor("#000")
    }

    // Row content
    doc.font("Courier").fontSize(8)
    doc.text(it.location,     COL.location.x,     y, { width: COL.location.width })
    doc.text(it.barcode,      COL.barcode.x,      y, { width: COL.barcode.width })
    doc.font("Helvetica").fontSize(8)
    doc.text(it.description,  COL.description.x,  y, { width: COL.description.width })
    doc.font("Courier").fontSize(8)
    doc.text(it.collectionNo, COL.collectionNo.x, y, { width: COL.collectionNo.width })
    doc.font("Helvetica").fontSize(10)
    doc.text("☐",             COL.tick.x,         y, { width: COL.tick.width, align: "center" })

    y += rowHeight

    // Light separator line
    doc.moveTo(doc.page.margins.left, y - 2)
       .lineTo(doc.page.width - doc.page.margins.right, y - 2)
       .lineWidth(0.3).strokeColor("#ccc").stroke().strokeColor("#000")
  }

  // Total row
  if (y + 30 > doc.page.height - doc.page.margins.bottom) {
    doc.addPage()
    y = doc.page.margins.top
  }
  y += 4
  doc.moveTo(doc.page.margins.left, y).lineTo(doc.page.width - doc.page.margins.right, y).lineWidth(1.2).stroke()
  doc.font("Helvetica-Bold").fontSize(9).fillColor("#000")
     .text(`Aisle ${aisle} total: ${items.length} item${items.length === 1 ? "" : "s"}`,
           doc.page.margins.left, y + 6)
}

function drawTableHeader(doc: PDFKit.PDFDocument, y: number) {
  doc.font("Helvetica-Bold").fontSize(8).fillColor("#000")
  doc.text("LOCATION",       COL.location.x,     y, { width: COL.location.width })
  doc.text("BARCODE",        COL.barcode.x,      y, { width: COL.barcode.width })
  doc.text("DESCRIPTION",    COL.description.x,  y, { width: COL.description.width })
  doc.text("COLLECTION NO.", COL.collectionNo.x, y, { width: COL.collectionNo.width })
  doc.text("✓",              COL.tick.x,         y, { width: COL.tick.width, align: "center" })
  doc.moveTo(doc.page.margins.left, y + 12)
     .lineTo(doc.page.width - doc.page.margins.right, y + 12)
     .lineWidth(0.8).stroke()
}
