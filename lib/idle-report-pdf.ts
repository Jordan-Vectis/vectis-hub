// PDF renderer for the Cataloguer Activity Report. Kept separate from the route
// so it can be unit-tested with synthetic data (no DB). Server-side pdf-lib —
// serverless-safe (see feedback: always pdf-lib, sharp logos, fixed layout).
import { PDFDocument, StandardFonts, PDFFont, rgb, RGB } from "pdf-lib"
import { embedVectisLogo } from "@/lib/pdf-logo"
import { fmtDuration, type IdleReportData } from "@/lib/idle-report"

// ─── Layout (A4 landscape) ──────────────────────────────────────────────────
const PAGE_W = 841.89
const PAGE_H = 595.28
const MARGIN = 36
const CONTENT_W = PAGE_W - MARGIN * 2

const INK    = rgb(0, 0, 0)
const GREY   = rgb(0.30, 0.30, 0.30)
const MUTE   = rgb(0.50, 0.50, 0.50)
const LINE   = rgb(0.80, 0.80, 0.80)
const FAINT  = rgb(0.92, 0.92, 0.92)
const AMBER  = rgb(0.85, 0.55, 0.05)
const RED    = rgb(0.79, 0.16, 0.16)
const TEAL   = rgb(0.16, 0.71, 0.65)
const ORANGE = rgb(0.90, 0.45, 0.13)

type Col = { title: string; x: number; w: number; align: "left" | "right" }

function hexToRgb(hex: string): RGB {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec((hex ?? "").trim())
  if (!m) return rgb(0.6, 0.6, 0.6)
  return rgb(parseInt(m[1], 16) / 255, parseInt(m[2], 16) / 255, parseInt(m[3], 16) / 255)
}

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

export async function buildIdleReportPdf(data: IdleReportData, rangeLabel: string, isAdmin: boolean): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  doc.setTitle("Cataloguer Activity Report")
  doc.setAuthor("Vectis Auctions")

  const helv  = await doc.embedFont(StandardFonts.Helvetica)
  const helvB = await doc.embedFont(StandardFonts.HelveticaBold)
  const logo  = await embedVectisLogo(doc)

  const printed = new Date().toLocaleString("en-GB", { timeZone: "Europe/London", weekday: "short", day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" })
  const labelOf  = (k: string) => data.reasonMeta.get(k)?.label ?? k
  const colourOf = (k: string) => hexToRgb(data.reasonMeta.get(k)?.idleColour ?? "#9ca3af")

  // ── Shared page state ──
  let page = doc.addPage([PAGE_W, PAGE_H])
  let y = 0

  const drawRight = (text: string, rightX: number, yy: number, size: number, font: PDFFont, color: RGB): void => {
    const s = safeAscii(text)
    page.drawText(s, { x: rightX - font.widthOfTextAtSize(s, size), y: yy, size, font, color })
  }

  const header = (): void => {
    const logoH = 34
    const logoW = logoH * (logo.width / logo.height)
    page.drawImage(logo, { x: MARGIN, y: PAGE_H - MARGIN - logoH, width: logoW, height: logoH })
    page.drawText("Cataloguer Activity Report", { x: MARGIN, y: PAGE_H - MARGIN - logoH - 15, size: 13, font: helvB, color: INK })
    drawRight(`Period: ${rangeLabel}`, PAGE_W - MARGIN, PAGE_H - MARGIN - 8, 10, helvB, INK)
    drawRight(`Generated ${printed}`, PAGE_W - MARGIN, PAGE_H - MARGIN - 22, 8, helv, MUTE)
    drawRight("Monday-Friday, 9am-5pm only", PAGE_W - MARGIN, PAGE_H - MARGIN - 34, 8, helv, MUTE)
    y = PAGE_H - MARGIN - logoH - 26
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

  // Renders a table with automatic page breaks; the column header is redrawn on
  // each new page. drawRow paints one row's cells at the current baseline (y - 8)
  // and must NOT advance y itself.
  const table = <T,>(cols: Col[], rows: T[], rowH: number, drawRow: (r: T, i: number) => void): void => {
    drawHeaderRow(cols)
    rows.forEach((r, i) => {
      if (y - rowH < MARGIN + 20) { page = doc.addPage([PAGE_W, PAGE_H]); header(); drawHeaderRow(cols) }
      drawRow(r, i)
      y -= rowH
      page.drawLine({ start: { x: MARGIN, y }, end: { x: PAGE_W - MARGIN, y }, thickness: 0.3, color: FAINT })
    })
  }

  const swatch = (x: number, key: string): void => {
    page.drawRectangle({ x, y: y - 9, width: 8, height: 8, color: colourOf(key) })
  }

  header()

  // ── Headline stat boxes ──
  const stats: { label: string; value: string; sub: string }[] = [
    { label: "Total Time Away", value: fmtDuration(data.totalIdleMs), sub: rangeLabel },
    { label: "Away Share of Day", value: data.idlePctOfDay != null ? `${data.idlePctOfDay}%` : "-", sub: "of the 9-5 day" },
    { label: "Away per Person / Day", value: fmtDuration(data.idlePerPersonDay), sub: `over ${data.personDays} day${data.personDays === 1 ? "" : "s"}` },
    { label: "Most Common Reason", value: data.topReason ? labelOf(data.topReason.key) : "-", sub: data.topReason ? `${fmtDuration(data.topReason.ms)} - ${Math.round(data.topReason.share)}%` : "none logged" },
  ]
  const gap = 12
  const boxW = (CONTENT_W - gap * 3) / 4
  const boxH = 54
  stats.forEach((s, i) => {
    const x = MARGIN + i * (boxW + gap)
    page.drawRectangle({ x, y: y - boxH, width: boxW, height: boxH, borderColor: LINE, borderWidth: 0.8, color: rgb(0.98, 0.98, 0.98) })
    page.drawRectangle({ x, y: y - boxH, width: 3, height: boxH, color: TEAL })
    page.drawText(safeAscii(s.label).toUpperCase(), { x: x + 10, y: y - 15, size: 7, font: helvB, color: MUTE })
    page.drawText(truncate(s.value, helvB, 17, boxW - 20), { x: x + 10, y: y - 35, size: 17, font: helvB, color: INK })
    page.drawText(truncate(s.sub, helv, 8, boxW - 20), { x: x + 10, y: y - 47, size: 8, font: helv, color: MUTE })
  })
  y -= boxH + 22

  // ── Activity reasons ──
  if (data.reasonRows.length) {
    sectionTitle("Activity reasons - the numbers")
    const cols: Col[] = [
      { title: "REASON",  x: MARGIN,        w: 220, align: "left"  },
      { title: "TOTAL",   x: MARGIN + 230,  w: 80,  align: "right" },
      { title: "TIMES",   x: MARGIN + 320,  w: 60,  align: "right" },
      { title: "AVG",     x: MARGIN + 390,  w: 80,  align: "right" },
      { title: "SHARE",   x: MARGIN + 480,  w: CONTENT_W - 480, align: "left" },
    ]
    table(cols, data.reasonRows, 15, (r) => {
      swatch(cols[0].x, r.key)
      page.drawText(truncate(r.label, helv, 9, cols[0].w - 14), { x: cols[0].x + 14, y: y - 8, size: 9, font: helv, color: INK })
      drawRight(fmtDuration(r.ms), cols[1].x + cols[1].w, y - 8, 9, helvB, INK)
      drawRight(String(r.count), cols[2].x + cols[2].w, y - 8, 9, helv, GREY)
      drawRight(fmtDuration(r.avg), cols[3].x + cols[3].w, y - 8, 9, helv, GREY)
      const barW = cols[4].w - 40
      page.drawRectangle({ x: cols[4].x, y: y - 9, width: barW, height: 7, color: FAINT })
      page.drawRectangle({ x: cols[4].x, y: y - 9, width: Math.max(1, barW * (r.share / 100)), height: 7, color: colourOf(r.key) })
      page.drawText(`${Math.round(r.share)}%`, { x: cols[4].x + barW + 6, y: y - 8, size: 8, font: helv, color: GREY })
    })
    y -= 16
  }

  // ── Per cataloguer ──
  sectionTitle(`Per cataloguer  (most time away first - avg break ${fmtDuration(data.avgSessionMs)})`)
  {
    const cols: Col[] = [
      { title: "#",              x: MARGIN,        w: 20,  align: "left"  },
      { title: "CATALOGUER",     x: MARGIN + 24,   w: 150, align: "left"  },
      { title: "AWAY",           x: MARGIN + 178,  w: 70,  align: "right" },
      { title: "PER DAY",        x: MARGIN + 252,  w: 70,  align: "right" },
      { title: "SHARE OF DAY",   x: MARGIN + 326,  w: 80,  align: "right" },
      { title: "BREAKS",         x: MARGIN + 410,  w: 55,  align: "right" },
      { title: "USUAL REASON",   x: MARGIN + 470,  w: 130, align: "left"  },
      { title: "NO REASON GIVEN", x: MARGIN + 604, w: 90, align: "right" },
      { title: "MOST TIME AWAY", x: MARGIN + 698,  w: CONTENT_W - 698, align: "left" },
    ]
    table(cols, data.userRows, 15, (r, i) => {
      drawRight(String(i + 1), cols[0].x + cols[0].w, y - 8, 8, helv, MUTE)
      const name = r.timerOff ? `${r.userName} (timer off)` : r.userName
      page.drawText(truncate(name, helvB, 9, cols[1].w), { x: cols[1].x, y: y - 8, size: 9, font: helvB, color: INK })
      drawRight(fmtDuration(r.totalMs), cols[2].x + cols[2].w, y - 8, 9, helvB, ORANGE)
      drawRight(fmtDuration(r.perDayMs), cols[3].x + cols[3].w, y - 8, 9, helv, GREY)
      const pctColor = r.pctDay == null ? MUTE : r.pctDay >= 25 ? RED : r.pctDay >= 15 ? AMBER : GREY
      const pctFont  = r.pctDay != null && r.pctDay >= 15 ? helvB : helv
      drawRight(r.pctDay != null ? `${r.pctDay}%` : "-", cols[4].x + cols[4].w, y - 8, 9, pctFont, pctColor)
      drawRight(r.sessions ? String(r.sessions) : "-", cols[5].x + cols[5].w, y - 8, 9, helv, GREY)
      if (r.topReasonKey) {
        swatch(cols[6].x, r.topReasonKey)
        page.drawText(truncate(labelOf(r.topReasonKey), helv, 9, cols[6].w - 14), { x: cols[6].x + 14, y: y - 8, size: 9, font: helv, color: INK })
      } else {
        page.drawText("-", { x: cols[6].x, y: y - 8, size: 9, font: helv, color: MUTE })
      }
      drawRight(r.unexplainedMs > 0 ? `${fmtDuration(r.unexplainedMs)} (${r.unexplainedCount})` : "-", cols[7].x + cols[7].w, y - 8, 9, r.unexplainedMs > 0 ? helvB : helv, r.unexplainedMs > 0 ? RED : MUTE)
      const busiest = r.busiestDay ? `${new Date(r.busiestDay + "T12:00:00").toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" })} - ${fmtDuration(r.busiestMs)}` : "-"
      page.drawText(truncate(busiest, helv, 8, cols[8].w), { x: cols[8].x, y: y - 8, size: 8, font: helv, color: GREY })
    })
    if (y - 14 < MARGIN + 20) { page = doc.addPage([PAGE_W, PAGE_H]); header() }
    y -= 6
    page.drawText('"No Reason Given" = a long working-hours gap between saved lots with no reason logged.', { x: MARGIN, y: y - 8, size: 7.5, font: helv, color: MUTE })
    y -= 22
  }

  // ── Longest single breaks ──
  if (data.longest.length) {
    sectionTitle("Longest single breaks")
    const cols: Col[] = [
      { title: "CATALOGUER", x: MARGIN,       w: 200, align: "left"  },
      { title: "LENGTH",     x: MARGIN + 210, w: 80,  align: "right" },
      { title: "REASON",     x: MARGIN + 300, w: 160, align: "left"  },
      { title: "WHEN",       x: MARGIN + 470, w: CONTENT_W - 470, align: "left" },
    ]
    table(cols, data.longest, 15, (l) => {
      page.drawText(truncate(l.userName, helvB, 9, cols[0].w), { x: cols[0].x, y: y - 8, size: 9, font: helvB, color: INK })
      drawRight(fmtDuration(l.idleDurationMs), cols[1].x + cols[1].w, y - 8, 9, helvB, ORANGE)
      swatch(cols[2].x, l.reason)
      page.drawText(truncate(labelOf(l.reason), helv, 9, cols[2].w - 14), { x: cols[2].x + 14, y: y - 8, size: 9, font: helv, color: INK })
      const when = l.idleStartedAt.toLocaleString("en-GB", { timeZone: "Europe/London", weekday: "short", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })
      page.drawText(truncate(when, helv, 8, cols[3].w), { x: cols[3].x, y: y - 8, size: 8, font: helv, color: GREY })
    })
    y -= 18
  }

  // ── Admin-only: clock-tamper incidents ──
  if (isAdmin && data.tamperIncidents.length) {
    sectionTitle("Flagged for review - saves made with the device clock/timezone changed away from UK time (admin only)")
    const cols: Col[] = [
      { title: "REAL (SERVER) TIME", x: MARGIN,       w: 200, align: "left" },
      { title: "CATALOGUER",         x: MARGIN + 210, w: 180, align: "left" },
      { title: "DEVICE SHOWED",      x: MARGIN + 400, w: 180, align: "left" },
      { title: "DEVICE TIMEZONE",    x: MARGIN + 590, w: CONTENT_W - 590, align: "left" },
    ]
    table(cols, data.tamperIncidents.slice(0, 300), 14, (d) => {
      const real = d.createdAt.toLocaleString("en-GB", { timeZone: "Europe/London", weekday: "short", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })
      let shown = "-"
      if (d.clientNow) { try { shown = d.clientNow.toLocaleString("en-GB", { timeZone: d.clientTz || "Europe/London", weekday: "short", hour: "2-digit", minute: "2-digit" }) } catch { shown = d.clientNow.toLocaleString("en-GB") } }
      page.drawText(truncate(real, helv, 8, cols[0].w), { x: cols[0].x, y: y - 8, size: 8, font: helv, color: GREY })
      page.drawText(truncate(d.userName, helv, 9, cols[1].w), { x: cols[1].x, y: y - 8, size: 9, font: helv, color: INK })
      page.drawText(truncate(shown, helvB, 8, cols[2].w), { x: cols[2].x, y: y - 8, size: 8, font: helvB, color: RED })
      page.drawText(truncate(d.clientTz ?? "-", helvB, 8, cols[3].w), { x: cols[3].x, y: y - 8, size: 8, font: helvB, color: RED })
    })
  }

  // ── Footer page numbers ──
  const pages = doc.getPages()
  pages.forEach((p, i) => {
    p.drawText("Vectis Auctions - Cataloguer Activity Report", { x: MARGIN, y: MARGIN - 18, size: 7, font: helv, color: MUTE })
    const label = `Page ${i + 1} of ${pages.length}`
    p.drawText(label, { x: PAGE_W - MARGIN - helv.widthOfTextAtSize(label, 7), y: MARGIN - 18, size: 7, font: helv, color: MUTE })
  })

  return await doc.save()
}
