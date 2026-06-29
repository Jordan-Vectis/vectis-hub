import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { getBCToken } from "@/lib/bc"
import { PDFDocument, StandardFonts, PDFFont, PDFPage, PDFImage, rgb } from "pdf-lib"
import { embedVectisLogo } from "@/lib/pdf-logo"
import { computeShippingAnalytics, type ShippingAnalytics } from "@/lib/shipping-analytics"
import { COUNTRY_NAMES } from "@/lib/country-names"

export const maxDuration = 300
export const runtime = "nodejs"

// GET /api/bc/shipping/pdf?from=YYYY-MM-DD&to=YYYY-MM-DD
// Server-side PDF of the shipping report — parcels by region, parcel-size
// breakdown, estimated revenue, and a country × size grid.
export async function GET(req: NextRequest) {
  try {
    const session = await auth()
    if (!session) return NextResponse.json({ error: "Unauthorised" }, { status: 401 })

    const token = await getBCToken()
    if (!token) return NextResponse.json({ error: "BC_NOT_CONNECTED" }, { status: 503 })

    const { searchParams } = req.nextUrl
    const from = searchParams.get("from")?.trim() ?? ""
    const to   = searchParams.get("to")?.trim()   ?? ""
    if (!from || !to) return NextResponse.json({ error: "Missing from/to" }, { status: 400 })

    const data = await computeShippingAnalytics(token, from, to)
    const pdfBytes = await buildPdf(data)

    const filename = `shipping-report-${from}_to_${to}.pdf`
    return new NextResponse(new Uint8Array(pdfBytes), {
      status: 200,
      headers: {
        "Content-Type":        "application/pdf",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Content-Length":      String(pdfBytes.length),
      },
    })
  } catch (e: any) {
    console.error("bc/shipping/pdf error:", e)
    return NextResponse.json({ error: e?.message ?? "PDF generation failed" }, { status: 500 })
  }
}

// ─── PDF builder ────────────────────────────────────────────────────────────

const PAGE_W = 595.28
const PAGE_H = 841.89
const MARGIN = 36
const RIGHT  = PAGE_W - MARGIN

const BLACK  = rgb(0, 0, 0)
const GREY   = rgb(0.30, 0.30, 0.30)
const LITE   = rgb(0.82, 0.82, 0.82)
const HEADBG = rgb(0.93, 0.95, 0.97)

type Fonts = { helv: PDFFont; helvB: PDFFont; logo: PDFImage }
type Col   = { title: string; x: number; w: number; align: "left" | "right" }

// Per-call drawing cursor — created inside buildPdf so concurrent PDF requests
// never share mutable page/position state.
type Cursor = { doc: PDFDocument; page: PDFPage; y: number; fonts: Fonts }

function money(n: number): string {
  return "£" + (n || 0).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}
function num(n: number): string { return (n || 0).toLocaleString("en-GB") }
function pct(n: number, total: number): string { return total ? `${((n / total) * 100).toFixed(1)}%` : "—" }
function countryLabel(code: string): string {
  const name = COUNTRY_NAMES[code]
  return name ? `${name} (${code})` : code
}

function safeAscii(text: string): string {
  return String(text ?? "")
    .replace(/[‘’‚‛]/g, "'")
    .replace(/[“”„‟]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/…/g, "...")
    .replace(/[  -   ⁠　]/g, " ") // non-breaking / unicode spaces -> normal space (before the ASCII strip below)
    .replace(/[^\x20-\x7E£€]/g, "")
}

async function buildPdf(d: ShippingAnalytics): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  doc.setTitle("Shipping Report")
  doc.setAuthor("Vectis Auctions")

  const fonts: Fonts = {
    helv:  await doc.embedFont(StandardFonts.Helvetica),
    helvB: await doc.embedFont(StandardFonts.HelveticaBold),
    logo:  await embedVectisLogo(doc),
  }

  const cur: Cursor = { doc, page: doc.addPage([PAGE_W, PAGE_H]), y: PAGE_H - MARGIN, fonts }
  const printed = new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })

  // ── Header ──
  const logoH = 44
  const logoW = logoH * (fonts.logo.width / fonts.logo.height)
  cur.page.drawImage(fonts.logo, { x: MARGIN, y: cur.y - logoH, width: logoW, height: logoH })
  drawRight(cur.page, "Shipping Report", RIGHT, cur.y - 12, 15, fonts.helvB, BLACK)
  drawRight(cur.page, `${d.from}  to  ${d.to}`, RIGHT, cur.y - 28, 10, fonts.helv, GREY)
  drawRight(cur.page, `Printed ${printed}`, RIGHT, cur.y - 41, 8, fonts.helv, GREY)
  cur.y -= logoH + 14
  cur.page.drawLine({ start: { x: MARGIN, y: cur.y }, end: { x: RIGHT, y: cur.y }, thickness: 1.5, color: BLACK })
  cur.y -= 22

  // ── Summary stat strip ──
  const stats: [string, string][] = [
    ["Parcels", num(d.meta.total)],
    ["Est. revenue (ex VAT)", money(d.meta.estRevenueTotal + d.meta.estRevenueUnlinked)],
    ["Countries", num(d.meta.countries)],
    ["Items shipped", num(d.meta.itemsWithSize + d.meta.estItemsUnlinked)],
  ]
  const sw = (RIGHT - MARGIN) / stats.length
  stats.forEach(([label, val], i) => {
    const x = MARGIN + i * sw
    cur.page.drawText(safeAscii(label.toUpperCase()), { x, y: cur.y, size: 8, font: fonts.helv, color: GREY })
    cur.page.drawText(safeAscii(val), { x, y: cur.y - 16, size: 15, font: fonts.helvB, color: BLACK })
  })
  cur.y -= 38

  drawWrapped(cur, "A parcel is one shipment. Items are the things inside it — a parcel can hold several, so there are more items than parcels.", 7.5, fonts.helv, GREY)
  cur.y -= 4
  if (d.meta.collectedRefund > 0) {
    drawWrapped(cur, `Shipping earned: ${money(d.meta.estRevenueTotal + d.meta.estRevenueUnlinked)} (posted parcels only — collected items aren't included). We'd have earned about ${money(d.meta.collectedRefund)} more if the items collected in person had been posted instead.`, 7.5, fonts.helv, GREY)
  }
  cur.y -= 6

  if (!d.meta.sizeDataAvailable) {
    sectionNote(cur, "Size & revenue data unavailable — run a full receipt-lines resync (BC Warehouse > Data Sync) to populate parcel sizes.")
  }

  // ── Region table ──
  {
    ensureSpace(cur, 90)
    sectionTitle(cur, "Parcels by Region", "How many parcels went to the UK, Europe and the rest of the world. Rest of World has no set price, so it shows £0.")
    const cols: Col[] = [
      { title: "REGION",       x: MARGIN,        w: 200, align: "left"  },
      { title: "PARCELS",      x: MARGIN + 200,  w: 90,  align: "right" },
      { title: "%",            x: MARGIN + 290,  w: 80,  align: "right" },
      { title: "EST. REVENUE", x: MARGIN + 370,  w: RIGHT - (MARGIN + 370), align: "right" },
    ]
    headerRow(cur, cols)
    for (const r of d.byRegion) {
      ensureSpace(cur, 16, () => headerRow(cur, cols))
      cell(cur, r.region, cols[0])
      cell(cur, num(r.parcels), cols[1])
      cell(cur, pct(r.parcels, d.meta.total), cols[2])
      cell(cur, money(r.revenue + r.estRevenue), cols[3])
      rowLine(cur)
    }
    cur.y -= 10
  }

  // ── Size table ──
  {
    ensureSpace(cur, 90)
    sectionTitle(cur, "Items by size", "How many items of each size we sent, and the shipping that earns.")
    const sizeTotal = d.bySize.reduce((s, r) => s + r.items, 0)
    const cols: Col[] = [
      { title: "SIZE",         x: MARGIN,        w: 200, align: "left"  },
      { title: "ITEMS",        x: MARGIN + 200,  w: 90,  align: "right" },
      { title: "%",            x: MARGIN + 290,  w: 80,  align: "right" },
      { title: "EST. REVENUE", x: MARGIN + 370,  w: RIGHT - (MARGIN + 370), align: "right" },
    ]
    headerRow(cur, cols)
    for (const r of d.bySize) {
      ensureSpace(cur, 16, () => headerRow(cur, cols))
      cell(cur, r.size, cols[0])
      cell(cur, num(r.items), cols[1])
      cell(cur, pct(r.items, sizeTotal), cols[2])
      cell(cur, money(r.revenue), cols[3])
      rowLine(cur)
    }
    // The un-docketed parcels' items can't be sized, so show them as a separate
    // estimate line (NOT a size row). Real sizes + this = the headline totals.
    if (d.meta.estItemsUnlinked > 0) {
      ensureSpace(cur, 14)
      drawWrapped(cur, `Plus about ${num(d.meta.estItemsUnlinked)} more items in parcels with no collection number — size unknown, so estimated at about ${money(d.meta.estRevenueUnlinked)}.`, 7.5, cur.fonts.helv, GREY)
    }
    cur.y -= 10
  }

  // ── Shipped vs Collected (standalone count by warehouse location) ──
  if (d.byDeliveryStatus.length > 0) {
    ensureSpace(cur, 80)
    sectionTitle(cur, "Where items are now", "Where these items are in the warehouse. This counts more than just shipped items (it also includes ones that were collected), so the numbers are higher.")
    const totalSC = d.byDeliveryStatus.reduce((s, r) => s + r.items, 0)
    const cols: Col[] = [
      { title: "STATUS", x: MARGIN,        w: 220, align: "left"  },
      { title: "ITEMS",  x: MARGIN + 220,  w: 120, align: "right" },
      { title: "%",      x: MARGIN + 340,  w: RIGHT - (MARGIN + 340), align: "right" },
    ]
    headerRow(cur, cols)
    for (const r of d.byDeliveryStatus) {
      ensureSpace(cur, 16, () => headerRow(cur, cols))
      cell(cur, r.status, cols[0])
      cell(cur, num(r.items), cols[1])
      cell(cur, pct(r.items, totalSC), cols[2])
      rowLine(cur)
    }
    if (d.meta.collectedRefund > 0) {
      ensureSpace(cur, 16)
      cur.page.drawText(safeAscii(`Est. revenue reduction from collections: ${money(d.meta.collectedRefund)} (UK rates)`),
        { x: MARGIN, y: cur.y - 4, size: 8.5, font: cur.fonts.helvB, color: BLACK })
      cur.y -= 16
    }
    cur.y -= 10
  }

  // ── Sizes: shipped vs collected ──
  if (d.sizeByDisposition.length > 0) {
    ensureSpace(cur, 90)
    sectionTitle(cur, "Sizes: shipped vs collected", "How many of each size were shipped vs collected in person — shows whether bigger items get collected more. From warehouse locations, so totals differ from 'Items by size' above.")
    const cols: Col[] = [
      { title: "SIZE",        x: MARGIN,        w: 150, align: "left"  },
      { title: "IN PERIOD",   x: MARGIN + 150,  w: 95,  align: "right" },
      { title: "SHIPPED",     x: MARGIN + 245,  w: 95,  align: "right" },
      { title: "COLLECTED",   x: MARGIN + 340,  w: 95,  align: "right" },
      { title: "% COLLECTED", x: MARGIN + 435,  w: RIGHT - (MARGIN + 435), align: "right" },
    ]
    headerRow(cur, cols)
    for (const r of d.sizeByDisposition) {
      ensureSpace(cur, 16, () => headerRow(cur, cols))
      const gone = r.shipped + r.collected
      cell(cur, r.size, cols[0])
      cell(cur, num(r.all), cols[1])
      cell(cur, num(r.shipped), cols[2])
      cell(cur, num(r.collected), cols[3])
      cell(cur, gone ? `${((r.collected / gone) * 100).toFixed(1)}%` : "-", cols[4])
      rowLine(cur)
    }
    drawWrapped(cur, "'% collected' = of the items that left (shipped or collected), the share picked up in person. 'In period' also counts items still in the warehouse.", 7, cur.fonts.helv, GREY)
    cur.y -= 10
  }

  // ── Monthly trend ──
  {
    ensureSpace(cur, 90)
    sectionTitle(cur, "Parcels by Month", "How many parcels and items we sent each month.")
    const cols: Col[] = [
      { title: "MONTH",        x: MARGIN,        w: 150, align: "left"  },
      { title: "PARCELS",      x: MARGIN + 150,  w: 90,  align: "right" },
      { title: "ITEMS",        x: MARGIN + 240,  w: 90,  align: "right" },
      { title: "EST. REVENUE", x: MARGIN + 330,  w: RIGHT - (MARGIN + 330), align: "right" },
    ]
    headerRow(cur, cols)
    for (const m of d.byMonth) {
      ensureSpace(cur, 16, () => headerRow(cur, cols))
      cell(cur, monthLabel(m.month), cols[0])
      cell(cur, num(m.parcels), cols[1])
      cell(cur, num(m.items + m.estItems), cols[2])
      cell(cur, money(m.revenue + m.estRevenue), cols[3])
      rowLine(cur)
    }
    cur.y -= 10
  }

  // ── Country × Size grid ──
  {
    ensureSpace(cur, 110)
    sectionTitle(cur, "Country breakdown", "Items, parcels and shipping for each country we sent to.")
    const sizes   = d.sizesPresent
    const nameW   = 150
    const revW    = 72
    const parcelW = 48
    const gridW   = RIGHT - MARGIN - nameW - revW - parcelW
    const sizeW   = sizes.length > 0 ? gridW / sizes.length : 0
    const cols: Col[] = [
      { title: "COUNTRY", x: MARGIN, w: nameW, align: "left" },
      ...sizes.map((s, i) => ({ title: shortSize(s), x: MARGIN + nameW + i * sizeW, w: sizeW, align: "right" as const })),
      { title: "PARCELS", x: MARGIN + nameW + gridW, w: parcelW, align: "right" as const },
      { title: "REVENUE", x: MARGIN + nameW + gridW + parcelW, w: revW, align: "right" as const },
    ]
    headerRow(cur, cols, 7)
    for (const r of d.byCountrySize) {
      ensureSpace(cur, 15, () => headerRow(cur, cols, 7))
      cell(cur, countryLabel(r.country), cols[0], 8)
      sizes.forEach((s, i) => {
        const c = r.sizes[s] ?? 0
        cell(cur, c ? num(c) : "·", cols[1 + i], 8)
      })
      cell(cur, num(r.parcels), cols[1 + sizes.length], 8)
      cell(cur, money(r.revenue), cols[2 + sizes.length], 8)
      rowLine(cur)
    }
  }

  // ── Footnote ──
  {
    ensureSpace(cur, 60)
    cur.y -= 8
    const notes = [
      "All figures are estimates and exclude VAT. Each parcel is priced as one full charge for its biggest item, plus a smaller charge for each other item, using Vectis's shipping rates.",
      `Rest of World has no set price, so ${num(d.meta.unratedParcels)} parcel(s) to those countries are counted but shown as £0.`,
      `${num(d.meta.parcelsWithoutSize)} collection(s) had no size recorded, so they add nothing to the revenue.`,
      `${num(d.meta.unlinkedParcels)} parcel(s) had no collection number in BC, so we couldn't see what was inside — their items and value are a rough estimate (about ${money(d.meta.estRevenueUnlinked)}).`,
    ]
    for (const n of notes) {
      ensureSpace(cur, 14)
      drawWrapped(cur, "- " + n, 7.5, fonts.helv, GREY, 10)
      cur.y -= 1
    }
  }

  return await doc.save()
}

// ─── Drawing helpers (all operate on the per-call cursor) ────────────────────

function ensureSpace(cur: Cursor, needed: number, onNewPage?: () => void) {
  if (cur.y - needed >= MARGIN + 16) return
  cur.page = cur.doc.addPage([PAGE_W, PAGE_H])
  cur.y = PAGE_H - MARGIN
  if (onNewPage) onNewPage()
}

function sectionTitle(cur: Cursor, title: string, subtitle?: string) {
  cur.page.drawText(safeAscii(title), { x: MARGIN, y: cur.y, size: 11, font: cur.fonts.helvB, color: BLACK })
  cur.y -= 13
  if (subtitle) {
    for (const ln of wrapLines(subtitle, cur.fonts.helv, 7.5, RIGHT - MARGIN)) {
      cur.page.drawText(ln, { x: MARGIN, y: cur.y, size: 7.5, font: cur.fonts.helv, color: GREY })
      cur.y -= 10
    }
    cur.y -= 1
  }
}

function headerRow(cur: Cursor, cols: Col[], size = 8) {
  cur.page.drawRectangle({ x: MARGIN, y: cur.y - 12, width: RIGHT - MARGIN, height: 15, color: HEADBG })
  for (const c of cols) drawCellRaw(cur.page, cur.fonts.helvB, c.title, c, cur.y, size, BLACK)
  cur.y -= 16
}

function cell(cur: Cursor, text: string, c: Col, size = 9) {
  drawCellRaw(cur.page, cur.fonts.helv, text, c, cur.y, size, BLACK)
}

function drawCellRaw(page: PDFPage, font: PDFFont, text: string, c: Col, y: number, size: number, color: any) {
  const safe = clip(safeAscii(text), font, size, c.w - 4)
  if (c.align === "right") {
    const w = font.widthOfTextAtSize(safe, size)
    page.drawText(safe, { x: c.x + c.w - 4 - w, y: y - 8, size, font, color })
  } else {
    page.drawText(safe, { x: c.x, y: y - 8, size, font, color })
  }
}

function rowLine(cur: Cursor) {
  cur.y -= 15
  cur.page.drawLine({ start: { x: MARGIN, y: cur.y + 3 }, end: { x: RIGHT, y: cur.y + 3 }, thickness: 0.3, color: LITE })
}

function sectionNote(cur: Cursor, text: string) {
  cur.page.drawRectangle({
    x: MARGIN, y: cur.y - 14, width: RIGHT - MARGIN, height: 18,
    color: rgb(1, 0.97, 0.85), borderColor: rgb(0.85, 0.7, 0.2), borderWidth: 0.5,
  })
  cur.page.drawText(safeAscii(text), { x: MARGIN + 6, y: cur.y - 9, size: 8, font: cur.fonts.helv, color: rgb(0.5, 0.35, 0) })
  cur.y -= 28
}

function drawRight(page: PDFPage, text: string, rightX: number, y: number, size: number, font: PDFFont, color: any) {
  const safe = safeAscii(text)
  const w = font.widthOfTextAtSize(safe, size)
  page.drawText(safe, { x: rightX - w, y, size, font, color })
}

function shortSize(s: string): string {
  if (s === "Collection Only") return "COLL"
  if (s === "Unspecified")     return "N/A"
  return s.slice(0, 6).toUpperCase()
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
function monthLabel(m: string): string {
  const mm = /^(\d{4})-(\d{2})$/.exec(m)
  return mm ? `${MONTHS[+mm[2] - 1]} ${mm[1]}` : m
}

// Truncate text to fit a width, trimming characters and adding ".." if needed.
function clip(text: string, font: PDFFont, size: number, maxWidth: number): string {
  if (font.widthOfTextAtSize(text, size) <= maxWidth) return text
  let t = text
  while (t.length > 1 && font.widthOfTextAtSize(t + "..", size) > maxWidth) t = t.slice(0, -1)
  return t + ".."
}

// Word-wrap text to a max width, returning the lines (so nothing runs off the page).
function wrapLines(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const words = safeAscii(text).split(/\s+/).filter(Boolean)
  const lines: string[] = []
  let line = ""
  for (const w of words) {
    const test = line ? `${line} ${w}` : w
    if (line && font.widthOfTextAtSize(test, size) > maxWidth) { lines.push(line); line = w }
    else line = test
  }
  if (line) lines.push(line)
  return lines
}

// Draw left-aligned wrapped text from the cursor, advancing cur.y per line.
function drawWrapped(cur: Cursor, text: string, size: number, font: PDFFont, color: any, lineH = size + 2.5) {
  for (const ln of wrapLines(text, font, size, RIGHT - MARGIN)) {
    cur.page.drawText(ln, { x: MARGIN, y: cur.y, size, font, color })
    cur.y -= lineH
  }
}
