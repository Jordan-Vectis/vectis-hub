import { NextRequest, NextResponse } from "next/server"
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib"
import { embedVectisLogo } from "@/lib/pdf-logo"
import { isMissingTable } from "@/lib/prisma-errors"
import { dayLabel, fromDefaults, mondayOf, ukYmd, weekdayOf, weekEnding, type Cell, type DaySchedule } from "@/lib/auction-schedule"
import { readDefaults, readSchedules, requireSchedule, salesForWeek } from "@/lib/auction-schedule-server"

// GET /api/auction-schedule/pdf?week=YYYY-MM-DD — the week laid out like the old spreadsheet,
// A4 landscape, one column per sale. pdf-lib only (RULES: never pdfkit).

const PAGE_W = 841.89
const PAGE_H = 595.28
const MARGIN = 28
const LABEL_W = 130
const SIZE = 10
const PAD = 4

const INK = rgb(0, 0, 0)
const RULE = rgb(0.55, 0.55, 0.55)
const SHADE = rgb(0.85, 0.88, 0.95) // the sheet's pale blue on alternate rows

// StandardFonts are WinAnsi — drop what they can't draw rather than throw.
const safe = (s: string) => (s ?? "").replace(/[–—]/g, "-").replace(/[^\x20-\x7E\xA0-\xFF£]/g, "")

function wrap(font: PDFFont, size: number, text: string, width: number): string[] {
  const out: string[] = []
  let line = ""
  for (const word of safe(text).split(/\s+/).filter(Boolean)) {
    const next = line ? line + " " + word : word
    if (font.widthOfTextAtSize(next, size) <= width || !line) line = next
    else { out.push(line); line = word }
  }
  if (line) out.push(line)
  return out.length ? out : [""]
}

const names = (cells: Cell[]) => cells.map(c => c.name).join(" / ")
const pair = (a: Cell | null, b: Cell | null) => (a || b ? `${a?.name ?? "-"} / ${b?.name ?? "-"}` : "")

export async function GET(req: NextRequest) {
  try {
    const who = await requireSchedule()
    const raw = req.nextUrl.searchParams.get("week") ?? ""
    const monday = mondayOf(/^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : ukYmd(new Date()))
    const sales = await salesForWeek(monday, who)
    let saved: Record<string, DaySchedule> = {}
    let defaults = {}
    try {
      ;[saved, defaults] = await Promise.all([readSchedules(sales.map(s => s.id)), readDefaults()])
    } catch (e: any) {
      if (!isMissingTable(e)) throw e
    }
    const days = sales.map(s => saved[s.id] ?? fromDefaults((defaults as any)[String(weekdayOf(s.date))]))

    // Rows of [label, one text per sale, small?]. Slot rows use the longest slot list.
    const rows: { label: string; cells: string[]; small?: boolean }[] = [
      { label: "Sale", cells: sales.map(s => dayLabel(s.date)) },
      { label: "Sale No.", cells: sales.map(s => s.code) },
      { label: "No. of Lots", cells: sales.map(s => String(s.lots)) },
      { label: "Start Time", cells: days.map(d => d.startTime) },
      { label: "Auctioneers", cells: days.map(d => names(d.auctioneers)) },
      { label: "", cells: sales.map(s => s.name), small: true },
      { label: "Clicking:", cells: sales.map(() => "Saleroom / Vectis") },
    ]
    const slotCount = Math.max(0, ...days.map(d => d.slots.length))
    for (let i = 0; i < slotCount; i++) {
      const time = days.find(d => d.slots[i])?.slots[i]?.time ?? ""
      rows.push({ label: time, cells: days.map(d => (d.slots[i] ? pair(d.slots[i].saleroom, d.slots[i].vectis) : "")) })
    }
    rows.push({ label: "Late (if required)", cells: days.map(d => names(d.late)) })
    rows.push({ label: "Telephone Bids", cells: days.map(d => names(d.phones)) })

    const doc = await PDFDocument.create()
    const font = await doc.embedFont(StandardFonts.Helvetica)
    const bold = await doc.embedFont(StandardFonts.HelveticaBold)
    const page: PDFPage = doc.addPage([PAGE_W, PAGE_H])

    const logo = await embedVectisLogo(doc)
    const logoH = 26
    const logoW = (logo.width / logo.height) * logoH
    page.drawImage(logo, { x: MARGIN, y: PAGE_H - MARGIN - logoH, width: logoW, height: logoH })
    const title = `Auctioneering Schedule W/E ${weekEnding(monday)}`
    page.drawText(title, { x: (PAGE_W - bold.widthOfTextAtSize(title, 16)) / 2, y: PAGE_H - MARGIN - 18, size: 16, font: bold, color: INK })

    let y = PAGE_H - MARGIN - logoH - 14
    if (!sales.length) {
      page.drawText("No sales are dated in this week.", { x: MARGIN, y, size: 12, font, color: INK })
    } else {
      const colW = Math.min(220, (PAGE_W - MARGIN * 2 - LABEL_W) / sales.length)
      const tableW = LABEL_W + colW * sales.length
      // Shrink the text if the table wouldn't fit the page.
      const lineH = (size: number) => size + 2
      const measure = (size: number) => rows.reduce((h, r) => {
        const s = r.small ? size - 1 : size
        const lines = Math.max(1, ...r.cells.map(c => wrap(font, s, c, colW - PAD * 2).length), wrap(font, s, r.label, LABEL_W - PAD * 2).length)
        return h + lines * lineH(s) + PAD * 2
      }, 0)
      let size = SIZE
      while (size > 6 && measure(size) > y - MARGIN) size -= 0.5

      rows.forEach((r, ri) => {
        const s = r.small ? size - 1 : size
        const cellLines = r.cells.map(c => wrap(font, s, c, colW - PAD * 2))
        const labelLines = wrap(font, s, r.label, LABEL_W - PAD * 2)
        const h = Math.max(1, labelLines.length, ...cellLines.map(l => l.length)) * lineH(s) + PAD * 2
        if (ri % 2 === 0) page.drawRectangle({ x: MARGIN, y: y - h, width: tableW, height: h, color: SHADE })
        labelLines.forEach((l, i) => page.drawText(l, { x: MARGIN + PAD, y: y - PAD - s - i * lineH(s), size: s, font, color: INK }))
        cellLines.forEach((lines, ci) => lines.forEach((l, i) =>
          page.drawText(l, { x: MARGIN + LABEL_W + ci * colW + PAD, y: y - PAD - s - i * lineH(s), size: s, font, color: INK })))
        page.drawLine({ start: { x: MARGIN, y: y - h }, end: { x: MARGIN + tableW, y: y - h }, thickness: 0.5, color: RULE })
        y -= h
      })
      const top = PAGE_H - MARGIN - logoH - 14
      page.drawLine({ start: { x: MARGIN, y: top }, end: { x: MARGIN + tableW, y: top }, thickness: 0.5, color: RULE })
      for (let c = 0; c <= sales.length + 1; c++) {
        const x = c === 0 ? MARGIN : MARGIN + LABEL_W + (c - 1) * colW
        page.drawLine({ start: { x, y: top }, end: { x, y }, thickness: 0.5, color: RULE })
      }
    }

    const bytes = await doc.save()
    return new NextResponse(Buffer.from(bytes), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="Auctioneering Schedule ${monday}.pdf"`,
      },
    })
  } catch (e: any) {
    if (!e?.http) console.error("auction-schedule pdf:", e)
    return NextResponse.json({ error: e?.message ?? "Unknown error" }, { status: e?.http ?? 500 })
  }
}
