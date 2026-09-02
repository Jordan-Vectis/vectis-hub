import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { PDFDocument, StandardFonts, PDFFont, PDFPage, PDFImage, rgb } from "pdf-lib"
import { embedVectisLogo } from "@/lib/pdf-logo"

export const dynamic = "force-dynamic"
export const maxDuration = 30
export const runtime = "nodejs"

// GET /api/reports/auctions-overview/pdf
// A4 portrait overview of all sales — lot counts, sale dates, and projected
// dates for thin/undated auctions based on their lot-addition rate.

const PAGE_W    = 595.28
const PAGE_H    = 841.89
const MARGIN    = 36
const RIGHT     = PAGE_W - MARGIN  // 559.28
const CONTENT_W = RIGHT - MARGIN   // 523.28

// --- Colour palette ---
const C = {
  black:    rgb(0.08, 0.08, 0.10),
  dark:     rgb(0.18, 0.18, 0.22),
  mid:      rgb(0.40, 0.40, 0.45),
  light:    rgb(0.65, 0.65, 0.68),
  rule:     rgb(0.82, 0.82, 0.86),
  stripe:   rgb(0.97, 0.97, 0.98),
  amber10:  rgb(1.00, 0.96, 0.88),
  amber60:  rgb(0.86, 0.62, 0.10),
  blue:     rgb(0.18, 0.46, 0.86),
  blueFill: rgb(0.18, 0.46, 0.86),
  barBg:    rgb(0.88, 0.88, 0.92),
  green:    rgb(0.13, 0.60, 0.35),
  headBg:   rgb(0.10, 0.14, 0.22),
  headTxt:  rgb(1.00, 1.00, 1.00),
  statBg1:  rgb(0.94, 0.96, 1.00),
  statBg2:  rgb(0.93, 0.98, 0.95),
  statBg3:  rgb(1.00, 0.96, 0.88),
  statBg4:  rgb(0.95, 0.95, 0.97),
}

// Sparse = active auction with fewer lots than this threshold (no sale date set)
const SPARSE_THRESHOLD = 100

type AuctionData = {
  id:          string
  code:        string
  name:        string
  auctionDate: Date | null
  auctionType: string
  lotCount:    number
  complete:    boolean
  catalogued:  boolean
  addedToBC:   boolean
  /** Lots whose BARCODE is in the synced BC data — measured, not the tick. */
  inBC:        number
  photography: boolean
  aiRan:       boolean
  firstLotAt:  Date | null
}

function typeLabel(t: string): string {
  const m: Record<string, string> = {
    GENERAL: "General", DIECAST: "Diecast", TRAINS: "Trains",
    VINYL: "Vinyl", TV_FILM: "TV/Film", MATCHBOX: "Matchbox",
    COMICS: "Comics", BEARS: "Teddies", DOLLS: "Dolls",
  }
  return m[t] ?? t
}

function fmtDate(d: Date | null | undefined, style: "short" | "long" = "short"): string {
  if (!d) return "Not set"
  const opts: Intl.DateTimeFormatOptions = style === "long"
    ? { day: "numeric", month: "long", year: "numeric" }
    : { day: "numeric", month: "short", year: "numeric" }
  return d.toLocaleDateString("en-GB", opts)
}

function fmtMonth(d: Date): string {
  return d.toLocaleDateString("en-GB", { month: "short", year: "numeric" })
}

function projectedInfo(a: AuctionData, target: number): { text: string; isEstimate: boolean } {
  if (a.auctionDate) return { text: fmtDate(a.auctionDate), isEstimate: false }
  if (a.lotCount === 0) return { text: "No lots yet", isEstimate: true }

  const daysSinceFirst = a.firstLotAt
    ? Math.max(1, (Date.now() - a.firstLotAt.getTime()) / 86_400_000)
    : 1
  const ratePerDay = a.lotCount / daysSinceFirst

  if (ratePerDay < 0.05) return { text: "Stalled", isEstimate: true }

  const remaining    = Math.max(0, target - a.lotCount)
  if (remaining <= 0) return { text: "Ready to schedule", isEstimate: true }

  const daysToTarget = Math.ceil(remaining / ratePerDay)
  const projected    = new Date(Date.now() + daysToTarget * 86_400_000)
  return { text: "Est. " + fmtMonth(projected), isEstimate: true }
}

export async function GET(req: NextRequest) {
  try {
    const session = await auth()
    if (!session) return NextResponse.json({ error: "Unauthorised" }, { status: 401 })

    const rawAuctions = await prisma.catalogueAuction.findMany({
      orderBy: [{ auctionDate: "asc" }, { createdAt: "desc" }],
      include: {
        _count: { select: { lots: true } },
        lots: {
          select: { createdAt: true },
          orderBy: { createdAt: "asc" },
          take: 1,
        },
      },
    })

    // ⚠⚠ "In BC" is MEASURED, not the old tick (2026-09-02). Same rule and same query as the
    // Auction Manager list: lots whose BARCODE is in the synced BC data, never receiptUniqueId.
    // The report used to print a "BC" flag straight off `addedToBC`, so a sale nobody had
    // remembered to tick read as not in BC — two different answers to one question.
    // ⚠ Reflects the last Data Sync, not BC live. The report says so in its own footnote.
    let inBC = new Map<string, number>()
    try {
      const rows = await prisma.$queryRaw<{ auctionId: string; n: bigint }[]>`
        SELECT l."auctionId" AS "auctionId", count(DISTINCT l.id) AS n
        FROM "CatalogueLot" l
        JOIN "WarehouseItem" w ON upper(w.barcode) = upper(l.barcode)
        WHERE l."auctionId" = ANY(${rawAuctions.map(a => a.id)}::text[])
          AND l.barcode IS NOT NULL AND btrim(l.barcode) <> ''
        GROUP BY l."auctionId"`
      inBC = new Map(rows.map(r => [r.auctionId, Number(r.n)]))
    } catch { /* the BC mirror is a convenience — never fail the whole report for it */ }

    const auctions: AuctionData[] = rawAuctions.map(a => ({
      id:          a.id,
      code:        a.code,
      name:        a.name,
      auctionDate: a.auctionDate,
      auctionType: a.auctionType,
      lotCount:    a._count.lots,
      complete:    a.complete,
      catalogued:  !!(a as any).catalogued,
      addedToBC:   !!(a as any).addedToBC,
      inBC:        inBC.get(a.id) ?? 0,
      photography: !!(a as any).photography,
      aiRan:       !!(a as any).aiRan,
      firstLotAt:  a.lots[0]?.createdAt ?? null,
    }))

    const completed = auctions.filter(a => a.complete)
    const active    = auctions.filter(a => !a.complete)

    // Target lot count = average of completed sales (default 250)
    const avgLots = completed.length > 0
      ? Math.round(completed.reduce((s, a) => s + a.lotCount, 0) / completed.length)
      : 250
    const targetLots = Math.max(150, Math.min(500, avgLots))

    // Sort active: dated first (ascending), then undated by lot count desc
    active.sort((a, b) => {
      if (a.auctionDate && !b.auctionDate) return -1
      if (!a.auctionDate && b.auctionDate) return 1
      if (a.auctionDate && b.auctionDate) return a.auctionDate.getTime() - b.auctionDate.getTime()
      return b.lotCount - a.lotCount
    })
    // Sort completed: most recent sale first
    completed.sort((a, b) => {
      if (!a.auctionDate && !b.auctionDate) return 0
      if (!a.auctionDate) return 1
      if (!b.auctionDate) return -1
      return b.auctionDate.getTime() - a.auctionDate.getTime()
    })

    const pdfBytes = await buildPdf(active, completed, targetLots)
    const filename  = `auctions-overview-${new Date().toISOString().slice(0, 10)}.pdf`

    return new NextResponse(new Uint8Array(pdfBytes), {
      status: 200,
      headers: {
        "Content-Type":        "application/pdf",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Content-Length":      String(pdfBytes.length),
      },
    })
  } catch (e: any) {
    console.error("auctions-overview/pdf error:", e)
    return NextResponse.json({ error: e?.message ?? "PDF generation failed" }, { status: 500 })
  }
}

// ─── PDF Builder ────────────────────────────────────────────────────────────

async function buildPdf(
  active:    AuctionData[],
  completed: AuctionData[],
  target:    number,
): Promise<Uint8Array> {
  const doc  = await PDFDocument.create()
  doc.setTitle("Auctions Overview")
  doc.setAuthor("Vectis Auctions")

  const helv  = await doc.embedFont(StandardFonts.Helvetica)
  const helvB = await doc.embedFont(StandardFonts.HelveticaBold)
  const logo  = await embedVectisLogo(doc)

  const printedDate = new Date().toLocaleDateString("en-GB", {
    weekday: "long", day: "numeric", month: "long", year: "numeric",
  })

  const totalActiveLots    = active.reduce((s, a) => s + a.lotCount, 0)
  const totalCompletedLots = completed.reduce((s, a) => s + a.lotCount, 0)
  const sparseCount        = active.filter(a => !a.auctionDate && a.lotCount < SPARSE_THRESHOLD).length

  const fonts: Fonts = { helv, helvB, logo }

  // ── Page 1 ──────────────────────────────────────────────────────────────
  let { page, y } = addPage(doc)

  // Logo + title header
  const logoH = 44
  const logoW = logoH * (logo.width / logo.height)
  page.drawImage(logo, { x: MARGIN, y: y - logoH, width: logoW, height: logoH })

  drawRight(page, safeAscii(`Printed ${printedDate}`), RIGHT, y - 8, 8, helv, C.mid)

  page.drawText("Auctions Overview", {
    x: MARGIN, y: y - logoH - 16, size: 20, font: helvB, color: C.dark,
  })
  page.drawText(`Target lots per sale: ${target} (based on ${completed.length} completed sales)`, {
    x: MARGIN, y: y - logoH - 32, size: 8, font: helv, color: C.light,
  })

  y -= logoH + 48

  // ── Stats bar (4 boxes) ──────────────────────────────────────────────────
  const boxW = Math.floor(CONTENT_W / 4) - 4
  const boxH = 54
  const statBoxes = [
    { label: "Active Sales",         value: String(active.length),    bg: C.statBg1, val: C.blue  },
    { label: "Lots in Progress",     value: totalActiveLots.toLocaleString(), bg: C.statBg1, val: C.blue  },
    { label: "Completed Sales",      value: String(completed.length), bg: C.statBg2, val: C.green },
    { label: "Awaiting Projection",  value: String(sparseCount),      bg: C.statBg3, val: C.amber60 },
  ]
  statBoxes.forEach((box, i) => {
    const bx = MARGIN + i * (boxW + 5)
    // (pdf-lib's drawRectangle has no borderRadius option — corners are square.)
    page.drawRectangle({ x: bx, y: y - boxH, width: boxW, height: boxH, color: box.bg })
    const valStr = safeAscii(box.value)
    const valW   = helvB.widthOfTextAtSize(valStr, 22)
    page.drawText(valStr, { x: bx + boxW / 2 - valW / 2, y: y - 30, size: 22, font: helvB, color: box.val })
    const lbl = safeAscii(box.label)
    const lblW = helv.widthOfTextAtSize(lbl, 7.5)
    page.drawText(lbl, { x: bx + boxW / 2 - lblW / 2, y: y - 46, size: 7.5, font: helv, color: C.mid })
  })

  y -= boxH + 24

  // ── Active Sales section ─────────────────────────────────────────────────
  ;({ page, y } = drawSectionHeading(doc, page, y, fonts, "ACTIVE SALES", active.length))

  if (active.length === 0) {
    page.drawText("No active sales.", { x: MARGIN, y: y - 14, size: 9, font: helv, color: C.mid })
    y -= 28
  } else {
    ;({ page, y } = drawActiveTableHeader(doc, page, y, fonts))
    for (let i = 0; i < active.length; i++) {
      ;({ page, y } = drawActiveRow(doc, page, y, fonts, active[i], i, target))
    }
  }

  y -= 20
  if (y < MARGIN + 80) {
    ;({ page, y } = addPage(doc))
  }

  // ── Completed Sales section ──────────────────────────────────────────────
  ;({ page, y } = drawSectionHeading(doc, page, y, fonts, "COMPLETED SALES", completed.length))

  if (completed.length === 0) {
    page.drawText("No completed sales.", { x: MARGIN, y: y - 14, size: 9, font: helv, color: C.mid })
    y -= 28
  } else {
    ;({ page, y } = drawCompletedTableHeader(doc, page, y, fonts))
    for (let i = 0; i < completed.length; i++) {
      ;({ page, y } = drawCompletedRow(doc, page, y, fonts, completed[i], i))
    }
  }

  // ── Footer on each page ──────────────────────────────────────────────────
  const pageCount = doc.getPageCount()
  for (let p = 0; p < pageCount; p++) {
    const pg = doc.getPage(p)
    const footerY = MARGIN - 14
    pg.drawLine({
      start: { x: MARGIN, y: footerY + 6 },
      end:   { x: RIGHT,  y: footerY + 6 },
      thickness: 0.4, color: C.rule,
    })
    const pageLabel = safeAscii(`Page ${p + 1} of ${pageCount}`)
    const pageLblW  = helv.widthOfTextAtSize(pageLabel, 7.5)
    pg.drawText(pageLabel, { x: RIGHT - pageLblW, y: footerY, size: 7.5, font: helv, color: C.light })
    pg.drawText("Vectis Auctions — Auctions Overview", { x: MARGIN, y: footerY, size: 7.5, font: helv, color: C.light })
    // ⚠ Say where the BC figure comes from. It is counted from the barcodes in the last Data
    // Sync, not asked of BC live, so a sale pushed since then reads low — which is a fact about
    // the sync, not the sale, and the reader has no other way to know that.
    pg.drawText(safeAscii("BC = lots found in Business Central by barcode, as at the last Data Sync"),
      { x: MARGIN + 168, y: footerY, size: 7, font: helv, color: C.light })
  }

  return doc.save()
}

// ─── Column layouts ──────────────────────────────────────────────────────────

// Active auctions table (width = 523.28)
const AC = {
  name:  { x: MARGIN,       w: 178 },
  type:  { x: MARGIN + 182, w: 56  },
  lots:  { x: MARGIN + 242, w: 58  },
  date:  { x: MARGIN + 304, w: 90  },
  proj:  { x: MARGIN + 398, w: 161 }, // to RIGHT (559.28)
}

// Completed auctions table (same page width)
const CC = {
  name:  { x: MARGIN,       w: 218 },
  type:  { x: MARGIN + 222, w: 60  },
  lots:  { x: MARGIN + 286, w: 60  },
  date:  { x: MARGIN + 350, w: 84  },
  // Pulled left to make room for the BC fraction — a short date only ever needs ~45pt.
  flags: { x: MARGIN + 440, w: 83  },
}

// ─── Section drawing helpers ─────────────────────────────────────────────────

type Fonts = { helv: PDFFont; helvB: PDFFont; logo: PDFImage }

function addPage(doc: PDFDocument): { page: PDFPage; y: number } {
  const page = doc.addPage([PAGE_W, PAGE_H])
  return { page, y: PAGE_H - MARGIN }
}

function ensureSpace(
  doc:    PDFDocument,
  page:   PDFPage,
  y:      number,
  needed: number,
): { page: PDFPage; y: number } {
  if (y - needed >= MARGIN + 24) return { page, y }
  return addPage(doc)
}

function drawSectionHeading(
  doc:   PDFDocument,
  page:  PDFPage,
  y:     number,
  fonts: Fonts,
  title: string,
  count: number,
): { page: PDFPage; y: number } {
  ;({ page, y } = ensureSpace(doc, page, y, 36))
  page.drawRectangle({ x: MARGIN, y: y - 20, width: CONTENT_W, height: 20, color: C.headBg })
  page.drawText(safeAscii(title), { x: MARGIN + 8, y: y - 14, size: 9, font: fonts.helvB, color: C.headTxt })
  const countStr = safeAscii(`${count} sale${count === 1 ? "" : "s"}`)
  drawRight(page, countStr, RIGHT - 8, y - 14, 8, fonts.helv, rgb(0.7, 0.75, 0.85))
  y -= 24
  return { page, y }
}

function drawActiveTableHeader(
  doc:   PDFDocument,
  page:  PDFPage,
  y:     number,
  fonts: Fonts,
): { page: PDFPage; y: number } {
  ;({ page, y } = ensureSpace(doc, page, y, 20))
  const hy = y - 6
  const headers: [string, number][] = [
    ["SALE",         AC.name.x],
    ["TYPE",         AC.type.x],
    ["LOTS",         AC.lots.x],
    ["SALE DATE",    AC.date.x],
    ["PROJECTED / STATUS", AC.proj.x],
  ]
  headers.forEach(([lbl, x]) => {
    page.drawText(lbl, { x, y: hy, size: 7, font: fonts.helvB, color: C.mid })
  })
  y -= 6
  page.drawLine({ start: { x: MARGIN, y }, end: { x: RIGHT, y }, thickness: 0.8, color: C.black })
  y -= 2
  return { page, y }
}

function drawCompletedTableHeader(
  doc:   PDFDocument,
  page:  PDFPage,
  y:     number,
  fonts: Fonts,
): { page: PDFPage; y: number } {
  ;({ page, y } = ensureSpace(doc, page, y, 20))
  const hy = y - 6
  const headers: [string, number][] = [
    ["SALE",     CC.name.x],
    ["TYPE",     CC.type.x],
    ["LOTS",     CC.lots.x],
    ["SALE DATE",CC.date.x],
    ["STATUS",   CC.flags.x],
  ]
  headers.forEach(([lbl, x]) => {
    page.drawText(lbl, { x, y: hy, size: 7, font: fonts.helvB, color: C.mid })
  })
  y -= 6
  page.drawLine({ start: { x: MARGIN, y }, end: { x: RIGHT, y }, thickness: 0.8, color: C.black })
  y -= 2
  return { page, y }
}

const ROW_H     = 22
const ROW_PAD_Y = 7   // baseline from top of row

function drawActiveRow(
  doc:    PDFDocument,
  page:   PDFPage,
  y:      number,
  fonts:  Fonts,
  a:      AuctionData,
  index:  number,
  target: number,
): { page: PDFPage; y: number } {
  ;({ page, y } = ensureSpace(doc, page, y, ROW_H + 2))

  const isSparse = !a.auctionDate && a.lotCount < SPARSE_THRESHOLD
  const isEven   = index % 2 === 0

  // Row background
  if (isSparse) {
    page.drawRectangle({ x: MARGIN, y: y - ROW_H, width: CONTENT_W, height: ROW_H, color: C.amber10 })
  } else if (isEven) {
    page.drawRectangle({ x: MARGIN, y: y - ROW_H, width: CONTENT_W, height: ROW_H, color: C.stripe })
  }

  const baseY = y - ROW_PAD_Y

  // ── Name + code ───────────────────────────────────────────────────────────
  const nameLines = wrapText(a.name, fonts.helvB, 8, AC.name.w - 4)
  if (nameLines.length > 1) {
    // Two-line name: bump row height
    nameLines.slice(0, 2).forEach((ln, i) => {
      page.drawText(ln, { x: AC.name.x, y: baseY - i * 9.5, size: 8, font: fonts.helvB, color: C.dark })
    })
    page.drawText(safeAscii(a.code), { x: AC.name.x, y: baseY - 19, size: 7, font: fonts.helv, color: C.light })
  } else {
    page.drawText(nameLines[0] ?? "", { x: AC.name.x, y: baseY, size: 8, font: fonts.helvB, color: C.dark })
    page.drawText(safeAscii(a.code),  { x: AC.name.x, y: baseY - 10, size: 7, font: fonts.helv, color: C.light })
  }

  // ── Type ─────────────────────────────────────────────────────────────────
  page.drawText(safeAscii(typeLabel(a.auctionType)), { x: AC.type.x, y: baseY, size: 8, font: fonts.helv, color: C.dark })

  // ── Lots: number + tiny bar ───────────────────────────────────────────────
  const lotsStr = String(a.lotCount)
  page.drawText(lotsStr, { x: AC.lots.x, y: baseY, size: 9, font: fonts.helvB, color: C.dark })

  const barW    = AC.lots.w - 4
  const fillPct = Math.min(a.lotCount / target, 1)
  const fillW   = Math.max(2, Math.round(fillPct * barW))
  const barY    = y - ROW_H + 5
  page.drawRectangle({ x: AC.lots.x, y: barY, width: barW, height: 4, color: C.barBg })
  if (fillW > 0) {
    page.drawRectangle({ x: AC.lots.x, y: barY, width: fillW, height: 4, color: C.blueFill })
  }

  // ── Sale date ─────────────────────────────────────────────────────────────
  const dateStr  = safeAscii(fmtDate(a.auctionDate))
  const dateCol  = a.auctionDate ? C.dark : C.light
  page.drawText(dateStr, { x: AC.date.x, y: baseY, size: 8, font: fonts.helv, color: dateCol })

  // ── Projection / status ───────────────────────────────────────────────────
  const { text: projText, isEstimate } = projectedInfo(a, target)
  const projFont  = isEstimate ? fonts.helvB : fonts.helv
  const projColor = isSparse ? C.amber60 : (a.auctionDate ? C.green : C.mid)
  page.drawText(safeAscii(projText), { x: AC.proj.x, y: baseY, size: 8, font: projFont, color: projColor })

  // ── Separator line ────────────────────────────────────────────────────────
  y -= ROW_H
  page.drawLine({
    start: { x: MARGIN, y },
    end:   { x: RIGHT,  y },
    thickness: 0.3, color: C.rule,
  })

  return { page, y }
}

function drawCompletedRow(
  doc:   PDFDocument,
  page:  PDFPage,
  y:     number,
  fonts: Fonts,
  a:     AuctionData,
  index: number,
): { page: PDFPage; y: number } {
  ;({ page, y } = ensureSpace(doc, page, y, ROW_H + 2))

  if (index % 2 === 0) {
    page.drawRectangle({ x: MARGIN, y: y - ROW_H, width: CONTENT_W, height: ROW_H, color: C.stripe })
  }

  const baseY = y - ROW_PAD_Y

  // Name + code
  const nameLines = wrapText(a.name, fonts.helv, 8, CC.name.w - 4)
  page.drawText(nameLines[0] ?? "", { x: CC.name.x, y: baseY, size: 8, font: fonts.helv, color: C.dark })
  page.drawText(safeAscii(a.code),  { x: CC.name.x, y: baseY - 10, size: 7, font: fonts.helv, color: C.light })

  // Type
  page.drawText(safeAscii(typeLabel(a.auctionType)), { x: CC.type.x, y: baseY, size: 8, font: fonts.helv, color: C.dark })

  // Lots
  page.drawText(String(a.lotCount), { x: CC.lots.x, y: baseY, size: 8, font: fonts.helvB, color: C.dark })

  // Sale date
  page.drawText(safeAscii(fmtDate(a.auctionDate)), { x: CC.date.x, y: baseY, size: 8, font: fonts.helv, color: C.dark })

  // Status flags (compact). ⚠ BC is MEASURED from the barcodes, not the old tick — a sale
  // nobody remembered to tick used to print as though it were not in BC at all.
  const flags: string[] = []
  if (a.lotCount > 0 && a.inBC > 0) flags.push(a.inBC >= a.lotCount ? "BC" : `BC ${a.inBC}/${a.lotCount}`)
  if (a.catalogued)  flags.push("Cat")
  if (a.photography) flags.push("Photo")
  if (flags.length > 0) {
    // 7pt, not 7.5 — a partial sale reads "BC 84/102 · Cat · Photo" and has to fit the margin.
    page.drawText(safeAscii(flags.join(" · ")), { x: CC.flags.x, y: baseY, size: 7, font: fonts.helv, color: C.green })
  }

  y -= ROW_H
  page.drawLine({
    start: { x: MARGIN, y },
    end:   { x: RIGHT,  y },
    thickness: 0.3, color: C.rule,
  })

  return { page, y }
}

// ─── Utilities ───────────────────────────────────────────────────────────────

function drawRight(page: PDFPage, text: string, rightX: number, y: number, size: number, font: PDFFont, color: any) {
  const safe = safeAscii(text)
  const w    = font.widthOfTextAtSize(safe, size)
  page.drawText(safe, { x: rightX - w, y, size, font, color })
}

function safeAscii(text: string): string {
  return (text ?? "")
    .replace(/[''‚‛]/g, "'")
    .replace(/[""„‟]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/…/g, "...")
    .replace(/ /g, " ")
    .replace(/[^\x20-\x7E\xa3\xa4]/g, "")
}

function wrapText(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const safe = safeAscii(text).replace(/\s+/g, " ").trim()
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
      if (font.widthOfTextAtSize(w, size) > maxWidth) {
        let chunk = ""
        for (const ch of w) {
          if (font.widthOfTextAtSize(chunk + ch, size) > maxWidth) { lines.push(chunk); chunk = ch }
          else chunk += ch
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
