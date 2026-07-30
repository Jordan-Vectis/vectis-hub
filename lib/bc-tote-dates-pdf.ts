// PDF renderer for the Manager Portal → "Using totes from — Business Central
// categories" table. Kept separate from the route so it can be exercised with
// synthetic data (no BC, no DB). Server-side pdf-lib — serverless-safe (house
// pattern: always pdf-lib, sharp logos, fixed layout).
//
// The figures come from computeBcToteDates, the same function the on-screen table
// uses, so the export can never disagree with the screen.
import { PDFDocument, StandardFonts, PDFFont, rgb, RGB } from "pdf-lib"
import { embedVectisLogo } from "@/lib/pdf-logo"
import { fmtLag, LAG_AMBER, LAG_RED, type BcToteDatesResult } from "@/lib/bc-tote-dates"

// ─── Layout (A4 portrait) ───────────────────────────────────────────────────
const PAGE_W = 595.28
const PAGE_H = 841.89
const MARGIN = 36
const CONTENT_W = PAGE_W - MARGIN * 2

const INK   = rgb(0, 0, 0)
const GREY  = rgb(0.30, 0.30, 0.30)
const MUTE  = rgb(0.50, 0.50, 0.50)
const LINE  = rgb(0.80, 0.80, 0.80)
const FAINT = rgb(0.92, 0.92, 0.92)
const AMBER = rgb(0.85, 0.55, 0.05)
const RED   = rgb(0.79, 0.16, 0.16)
const TEAL  = rgb(0.16, 0.71, 0.65)

type Col = { title: string; x: number; w: number; align: "left" | "right" }

// pdf-lib's standard fonts are WinAnsi — anything outside it throws on draw.
function safeAscii(text: string): string {
  return (text ?? "")
    .replace(/[‘’‚‛]/g, "'")
    .replace(/[“”„‟]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/…/g, "...")
    .replace(/ /g, " ")
    .replace(/[^\x20-\x7E£€]/g, "")
    .trim()
}

function truncate(text: string, font: PDFFont, size: number, maxW: number): string {
  let s = safeAscii(text)
  if (font.widthOfTextAtSize(s, size) <= maxW) return s
  while (s.length > 1 && font.widthOfTextAtSize(s + "...", size) > maxW) s = s.slice(0, -1)
  return s + "..."
}

function wrap(text: string, font: PDFFont, size: number, maxW: number): string[] {
  const words = safeAscii(text).split(/\s+/).filter(Boolean)
  const lines: string[] = []
  let line = ""
  for (const w of words) {
    const next = line ? `${line} ${w}` : w
    if (font.widthOfTextAtSize(next, size) > maxW && line) { lines.push(line); line = w }
    else line = next
  }
  if (line) lines.push(line)
  return lines
}

const fmtMonth = (ms: number) =>
  new Date(ms).toLocaleDateString("en-GB", { month: "short", year: "numeric", timeZone: "Europe/London" })
const fmtDate = (ms: number) =>
  new Date(ms).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "2-digit", timeZone: "Europe/London" })

function lagColour(fromMs: number, nowMs: number): RGB {
  const days = (nowMs - fromMs) / 86_400_000
  if (days >= LAG_RED)   return RED
  if (days >= LAG_AMBER) return AMBER
  return GREY
}

export async function buildBcToteDatesPdf(
  data: BcToteDatesResult,
  nowMs: number,
  opts: { includeTotes?: boolean } = {},
): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  doc.setTitle("Using totes from - Business Central categories")
  doc.setAuthor("Vectis Auctions")

  const helv  = await doc.embedFont(StandardFonts.Helvetica)
  const helvB = await doc.embedFont(StandardFonts.HelveticaBold)
  const mono  = await doc.embedFont(StandardFonts.Courier)
  const logo  = await embedVectisLogo(doc)

  const printed = new Date().toLocaleString("en-GB", {
    timeZone: "Europe/London", weekday: "short", day: "numeric", month: "long",
    year: "numeric", hour: "2-digit", minute: "2-digit",
  })

  let page = doc.addPage([PAGE_W, PAGE_H])
  let y = 0

  const drawRight = (text: string, rightX: number, yy: number, size: number, font: PDFFont, color: RGB): void => {
    const s = safeAscii(text)
    page.drawText(s, { x: rightX - font.widthOfTextAtSize(s, size), y: yy, size, font, color })
  }

  const header = (): void => {
    const logoH = 30
    const logoW = logoH * (logo.width / logo.height)
    page.drawImage(logo, { x: MARGIN, y: PAGE_H - MARGIN - logoH, width: logoW, height: logoH })
    page.drawText("Using totes from", { x: MARGIN, y: PAGE_H - MARGIN - logoH - 15, size: 13, font: helvB, color: INK })
    page.drawText("Business Central categories - how far behind cataloguing is running",
      { x: MARGIN, y: PAGE_H - MARGIN - logoH - 27, size: 8, font: helv, color: MUTE })
    drawRight(`Generated ${printed}`, PAGE_W - MARGIN, PAGE_H - MARGIN - 10, 8, helv, MUTE)
    y = PAGE_H - MARGIN - logoH - 38
    page.drawLine({ start: { x: MARGIN, y }, end: { x: PAGE_W - MARGIN, y }, thickness: 1.2, color: INK })
    y -= 18
  }

  const drawHeaderRow = (cols: Col[]): void => {
    for (const c of cols) {
      if (c.align === "right") drawRight(c.title, c.x + c.w, y - 8, 7, helvB, MUTE)
      else page.drawText(c.title, { x: c.x, y: y - 8, size: 7, font: helvB, color: MUTE })
    }
    page.drawLine({ start: { x: MARGIN, y: y - 12 }, end: { x: PAGE_W - MARGIN, y: y - 12 }, thickness: 0.8, color: LINE })
    y -= 16
  }

  const sectionTitle = (title: string): void => {
    if (y - 30 < MARGIN + 20) { page = doc.addPage([PAGE_W, PAGE_H]); header() }
    page.drawText(safeAscii(title).toUpperCase(), { x: MARGIN, y: y - 9, size: 9, font: helvB, color: GREY })
    y -= 18
  }

  header()

  // ── Headline: where the team is furthest behind ──
  const dated = data.categories.filter(c => c.monthMs != null)
  const worst = dated[0]                              // already sorted oldest-first
  const best  = dated[dated.length - 1]
  const stats: { label: string; value: string; sub: string }[] = [
    { label: "Categories", value: String(data.categories.length), sub: `${dated.length} with dated totes` },
    worst
      ? { label: "Furthest Behind", value: worst.category, sub: `${fmtMonth(worst.monthMs!)} - ${fmtLag(worst.monthMs!, nowMs)} behind` }
      : { label: "Furthest Behind", value: "-", sub: "no dated totes" },
    best
      ? { label: "Most Up To Date", value: best.category, sub: `${fmtMonth(best.monthMs!)} - ${fmtLag(best.monthMs!, nowMs)} behind` }
      : { label: "Most Up To Date", value: "-", sub: "no dated totes" },
  ]
  const gap = 12
  const boxW = (CONTENT_W - gap * (stats.length - 1)) / stats.length
  const boxH = 50
  stats.forEach((s, i) => {
    const x = MARGIN + i * (boxW + gap)
    page.drawRectangle({ x, y: y - boxH, width: boxW, height: boxH, borderColor: LINE, borderWidth: 0.8, color: rgb(0.98, 0.98, 0.98) })
    page.drawRectangle({ x, y: y - boxH, width: 3, height: boxH, color: TEAL })
    page.drawText(safeAscii(s.label).toUpperCase(), { x: x + 9, y: y - 14, size: 6.5, font: helvB, color: MUTE })
    page.drawText(truncate(s.value, helvB, 13, boxW - 18), { x: x + 9, y: y - 31, size: 13, font: helvB, color: INK })
    page.drawText(truncate(s.sub, helv, 7.5, boxW - 18), { x: x + 9, y: y - 43, size: 7.5, font: helv, color: MUTE })
  })
  y -= boxH + 20

  // ── The table ──
  sectionTitle("By Business Central category - furthest behind first")

  const cols: Col[] = [
    { title: "BC CATEGORY",       x: MARGIN,       w: 118, align: "left"  },
    { title: "USING TOTES FROM",  x: MARGIN + 122, w:  74, align: "left"  },
    { title: "HOW FAR BEHIND",    x: MARGIN + 200, w:  90, align: "left"  },
    { title: "LAST WORKED",       x: MARGIN + 294, w:  62, align: "left"  },
    { title: "TOTES",             x: MARGIN + 360, w:  36, align: "right" },
    { title: "CATALOGUED",        x: MARGIN + 400, w:  60, align: "right" },
    { title: "STILL TO DO",       x: MARGIN + 464, w:  59, align: "right" },
  ]

  drawHeaderRow(cols)
  const rowH = 15
  for (const c of data.categories) {
    if (y - rowH < MARGIN + 26) { page = doc.addPage([PAGE_W, PAGE_H]); header(); drawHeaderRow(cols) }
    const base = y - 10

    page.drawText(truncate(c.category, helvB, 8, cols[0].w), { x: cols[0].x, y: base, size: 8, font: helvB, color: INK })

    if (c.monthMs != null) {
      const tone = lagColour(c.monthMs, nowMs)
      page.drawText(fmtMonth(c.monthMs), { x: cols[1].x, y: base, size: 8, font: helvB, color: INK })
      // bar + words, same reading as the screen
      const barW = 44
      const pct  = Math.max(0.06, Math.min(1, ((nowMs - c.monthMs) / 86_400_000) / LAG_RED))
      page.drawRectangle({ x: cols[2].x, y: base + 1, width: barW, height: 3.5, color: FAINT })
      page.drawRectangle({ x: cols[2].x, y: base + 1, width: barW * pct, height: 3.5, color: tone })
      page.drawText(`${fmtLag(c.monthMs, nowMs)} behind`, { x: cols[2].x + barW + 5, y: base, size: 7.5, font: helv, color: tone })
    } else {
      page.drawText(c.sampled > 0 ? "no dates on those totes" : "nothing catalogued yet",
        { x: cols[1].x, y: base, size: 7.5, font: helv, color: MUTE })
    }

    page.drawText(c.lastCataloguedMs != null ? fmtDate(c.lastCataloguedMs) : "-",
      { x: cols[3].x, y: base, size: 8, font: helv, color: GREY })
    drawRight(`${c.sampled}${c.estimatedCount > 0 ? "*" : ""}`, cols[4].x + cols[4].w, base, 8, helv, c.sampled < 10 ? AMBER : GREY)
    drawRight(c.catalogued.toLocaleString("en-GB"),  cols[5].x + cols[5].w, base, 8, helv,  GREY)
    drawRight(c.outstanding.toLocaleString("en-GB"), cols[6].x + cols[6].w, base, 8, helvB, c.outstanding > 0 ? INK : MUTE)

    y -= rowH
    page.drawLine({ start: { x: MARGIN, y }, end: { x: PAGE_W - MARGIN, y }, thickness: 0.3, color: FAINT })
  }
  y -= 8

  // ── Optional: the totes behind each month ──
  if (opts.includeTotes) {
    sectionTitle("The totes behind each month - newest first")
    for (const c of data.categories) {
      if (c.totes.length === 0) continue
      if (y - 26 < MARGIN + 26) { page = doc.addPage([PAGE_W, PAGE_H]); header() }
      page.drawText(truncate(c.category, helvB, 8, 120), { x: MARGIN, y: y - 9, size: 8, font: helvB, color: INK })
      const line = c.totes
        .map(t => `${t.tote} ${t.dateMs != null ? `${t.estimated ? "~" : ""}${fmtDate(t.dateMs)}` : "no date"}`)
        .join("   ")
      const lines = wrap(line, mono, 6.5, CONTENT_W - 128)
      lines.forEach((ln, i) => {
        page.drawText(ln, { x: MARGIN + 126, y: y - 9 - i * 8, size: 6.5, font: mono, color: GREY })
      })
      y -= Math.max(14, lines.length * 8 + 6)
    }
    y -= 4
  }

  // ── Footnotes: how to read it, and where the numbers come from ──
  if (y - 60 < MARGIN) { page = doc.addPage([PAGE_W, PAGE_H]); header() }
  page.drawLine({ start: { x: MARGIN, y }, end: { x: PAGE_W - MARGIN, y }, thickness: 0.8, color: LINE })
  y -= 12
  const notes = [
    `"Using totes from" is the middle (median) check-in month of the newest 10 totes ticked as catalogued in Business Central - i.e. where cataloguing has got to in each category. Amber from ${LAG_AMBER} days behind, red from ${LAG_RED}.`,
    data.diagnostics.note,
    "* fewer than 10 totes available, or some dates estimated - the on-screen table shows which.",
  ]
  for (const n of notes) {
    for (const ln of wrap(n, helv, 6.5, CONTENT_W)) {
      if (y - 9 < MARGIN) { page = doc.addPage([PAGE_W, PAGE_H]); header() }
      page.drawText(ln, { x: MARGIN, y: y - 7, size: 6.5, font: helv, color: MUTE })
      y -= 9
    }
    y -= 3
  }

  return await doc.save()
}
