// PDF renderer for the individual Cataloguer Report (the "standard" reports page
// export — one section per cataloguer). Kept separate from the route so it can be
// unit-tested with synthetic data (no DB). Server-side pdf-lib — serverless-safe,
// same engine and house style as lib/idle-report-pdf.ts (see feedback: always
// pdf-lib, sharp logos, fixed layout).
//
// The route does the DB work + aggregation (mirroring the on-screen page so the
// numbers can't drift) and hands finished PersonPdfReport objects in here.
import { PDFDocument, StandardFonts, PDFFont, rgb, RGB } from "pdf-lib"
import { embedVectisLogo } from "@/lib/pdf-logo"

// ─── Layout (A4 landscape) ──────────────────────────────────────────────────
const PAGE_W = 841.89
const PAGE_H = 595.28
const MARGIN = 36
const CONTENT_W = PAGE_W - MARGIN * 2

const INK     = rgb(0, 0, 0)
const GREY    = rgb(0.30, 0.30, 0.30)
const MUTE    = rgb(0.50, 0.50, 0.50)
const LINE    = rgb(0.80, 0.80, 0.80)
const FAINT   = rgb(0.92, 0.92, 0.92)
const BAND    = rgb(0.95, 0.95, 0.95)
const RED     = rgb(0.79, 0.16, 0.16)
const GREEN   = rgb(0.13, 0.63, 0.42)
const TEAL    = rgb(0.16, 0.71, 0.65)
const ORANGE  = rgb(0.90, 0.45, 0.13)
const BLUE    = rgb(0.23, 0.51, 0.96)
const PURPLE  = rgb(0.66, 0.33, 0.97)
const EMERALD = rgb(0.13, 0.70, 0.53)
const ORANGEB = rgb(0.98, 0.57, 0.24)

const UK_TZ = "Europe/London"
const fTime   = new Intl.DateTimeFormat("en-GB", { timeZone: UK_TZ, hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }) // 09:41:12
const fHM     = new Intl.DateTimeFormat("en-GB", { timeZone: UK_TZ, hour: "2-digit", minute: "2-digit", hour12: false })                    // 13:00
const fDate   = new Intl.DateTimeFormat("en-GB", { timeZone: UK_TZ, day: "2-digit", month: "2-digit", year: "numeric" })                    // 06/07/2026
const fDayLbl = new Intl.DateTimeFormat("en-GB", { timeZone: UK_TZ, weekday: "short", day: "numeric", month: "short", year: "numeric" })    // Mon 6 Jul 2026
const fDayKey = new Intl.DateTimeFormat("en-CA", { timeZone: UK_TZ, year: "numeric", month: "2-digit", day: "2-digit" })                    // 2026-07-06

// ─── Public data shapes (pure — route fills these) ──────────────────────────
export type PdfReasonMeta = { label: string; idleColour: string }

export type PdfLotEntry = {
  ts: string                 // ISO instant of the save
  durationMs: number
  method: string             // WIZARD | PHOTO_ONLY
  barcode: string | null
  keyPointsMs: number | null
  auctionCode: string
  auctionName: string
}
export type PdfIdleEntry = {
  ts: string                 // ISO instant the break started
  durationMs: number
  reasonKey: string
  toteNumbers: string | null
  notes: string | null
  auctionCode: string
  auctionName: string
  excluded: boolean          // over 10h — shown but not counted (device left open)
}

export type PdfAuctionStat = { code: string; name: string; count: number; avgMs: number; fastestMs: number; slowestMs: number }

export type PersonPdfReport = {
  userName: string
  lotsInRange: number
  avgMs: number; fastestMs: number; slowestMs: number
  dailyAvg: number; completedDays: number
  totalCatMs: number; totalIdleMs: number
  activePct: number | null; idlePct: number | null
  wizardCount: number; wizardAvgMs: number
  photoCount: number;  photoAvgMs: number
  kpCount: number; wizardTracked: number
  kpAvgMs: number; kpFastMs: number; kpSlowMs: number; kpPct: number
  researchMs: number; researchSessions: number
  auctionStats: PdfAuctionStat[]
  lots: PdfLotEntry[]
  idle: PdfIdleEntry[]
}

// ─── Small helpers ──────────────────────────────────────────────────────────
function hexToRgb(hex: string): RGB {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec((hex ?? "").trim())
  if (!m) return rgb(0.6, 0.6, 0.6)
  return rgb(parseInt(m[1], 16) / 255, parseInt(m[2], 16) / 255, parseInt(m[3], 16) / 255)
}

// pdf-lib's StandardFonts are WinAnsi only — strip anything they can't draw
// (smart quotes, dashes, emoji) so a stray character can't throw mid-render.
function safeAscii(text: string): string {
  return (text ?? "")
    .replace(/[‘’‚‛]/g, "'")
    .replace(/[“”„‟]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/…/g, "...")
    .replace(/ /g, " ")
    .replace(/[^\x20-\x7E£€]/g, "")
    .trim()
}

function truncate(text: string, font: PDFFont, size: number, maxW: number): string {
  let s = safeAscii(text)
  if (font.widthOfTextAtSize(s, size) <= maxW) return s
  while (s.length > 1 && font.widthOfTextAtSize(s + "...", size) > maxW) s = s.slice(0, -1)
  return s + "..."
}

/** Human duration, e.g. "1h 22m 5s". Matches the on-screen report (keeps seconds). */
function fmtDur(ms: number | null | undefined): string {
  if (!ms || ms <= 0) return "-"
  const t = Math.floor(ms / 1000)
  const h = Math.floor(t / 3600)
  const m = Math.floor((t % 3600) / 60)
  const s = t % 60
  if (h > 0) return `${h}h ${m}m ${s}s`
  if (m > 0) return `${m}m ${s}s`
  return `${s}s`
}

function methodLabel(method: string): string {
  if (method === "WIZARD") return "Wizard"
  if (method === "PHOTO_ONLY") return "Photo only"
  return method
}

type Col = { title: string; x: number; w: number; align: "left" | "right" }

// ─── Builder ────────────────────────────────────────────────────────────────
export async function buildReportsPdf(
  persons: PersonPdfReport[],
  rangeLabel: string,
  reasonMeta: Map<string, PdfReasonMeta>,
): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  doc.setTitle("Cataloguer Report")
  doc.setAuthor("Vectis Auctions")

  const helv  = await doc.embedFont(StandardFonts.Helvetica)
  const helvB = await doc.embedFont(StandardFonts.HelveticaBold)
  const logo  = await embedVectisLogo(doc)

  const printed  = new Date().toLocaleString("en-GB", { timeZone: UK_TZ, weekday: "short", day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" })
  const labelOf  = (k: string) => reasonMeta.get(k)?.label ?? k
  const colourOf = (k: string) => hexToRgb(reasonMeta.get(k)?.idleColour ?? "#9ca3af")

  let page = doc.addPage([PAGE_W, PAGE_H])
  let y = 0
  let currentPerson = ""

  const drawRight = (text: string, rightX: number, yy: number, size: number, font: PDFFont, color: RGB): void => {
    const s = safeAscii(text)
    page.drawText(s, { x: rightX - font.widthOfTextAtSize(s, size), y: yy, size, font, color })
  }

  const header = (): void => {
    const logoH = 30
    const logoW = logoH * (logo.width / logo.height)
    page.drawImage(logo, { x: MARGIN, y: PAGE_H - MARGIN - logoH, width: logoW, height: logoH })
    page.drawText("Cataloguer Report", { x: MARGIN, y: PAGE_H - MARGIN - logoH - 13, size: 11, font: helvB, color: MUTE })
    if (currentPerson) page.drawText(truncate(currentPerson, helvB, 16, 400), { x: MARGIN, y: PAGE_H - MARGIN - logoH - 32, size: 16, font: helvB, color: INK })
    drawRight(`Period: ${rangeLabel}`, PAGE_W - MARGIN, PAGE_H - MARGIN - 6, 10, helvB, INK)
    drawRight(`Generated ${printed}`, PAGE_W - MARGIN, PAGE_H - MARGIN - 20, 8, helv, MUTE)
    drawRight("Time away counts Mon-Fri, 9am-5pm only", PAGE_W - MARGIN, PAGE_H - MARGIN - 32, 8, helv, MUTE)
    y = PAGE_H - MARGIN - logoH - 42
    page.drawLine({ start: { x: MARGIN, y }, end: { x: PAGE_W - MARGIN, y }, thickness: 1.2, color: INK })
    y -= 18
  }

  const newPage = (): void => { page = doc.addPage([PAGE_W, PAGE_H]); header() }
  const ensure  = (space: number): void => { if (y - space < MARGIN + 24) newPage() }

  const sectionTitle = (title: string): void => {
    ensure(30)
    page.drawText(safeAscii(title).toUpperCase(), { x: MARGIN, y: y - 9, size: 9, font: helvB, color: GREY })
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

  // Generic table with automatic page breaks; the column header redraws on each
  // new page. drawRow paints one row at baseline (y - 8) and must NOT advance y.
  const table = <T,>(cols: Col[], rows: T[], rowH: number, drawRow: (r: T, i: number) => void): void => {
    drawHeaderRow(cols)
    rows.forEach((r, i) => {
      if (y - rowH < MARGIN + 24) { newPage(); drawHeaderRow(cols) }
      drawRow(r, i)
      y -= rowH
      page.drawLine({ start: { x: MARGIN, y }, end: { x: PAGE_W - MARGIN, y }, thickness: 0.3, color: FAINT })
    })
  }

  const swatch = (x: number, key: string): void => {
    page.drawRectangle({ x, y: y - 9, width: 8, height: 8, color: colourOf(key) })
  }

  // ─── Per-person section ───────────────────────────────────────────────────
  persons.forEach((p, personIdx) => {
    currentPerson = p.userName
    if (personIdx === 0) header()
    else newPage()

    const hasData = p.lotsInRange > 0 || p.idle.length > 0
    if (!hasData) {
      page.drawText("No lots or time away logged in this period.", { x: MARGIN, y: y - 20, size: 11, font: helv, color: MUTE })
      return
    }

    // ── Headline stat boxes ──
    const stats: { label: string; value: string; sub: string }[] = [
      { label: "Lots in Range",  value: p.lotsInRange.toLocaleString(),  sub: rangeLabel },
      { label: "Avg Time / Lot", value: fmtDur(p.avgMs),                 sub: "all methods" },
      { label: "Daily Average",  value: p.dailyAvg.toLocaleString(),     sub: p.completedDays > 0 ? `over ${p.completedDays} full day${p.completedDays === 1 ? "" : "s"}` : "today only" },
      { label: "Total Time Away",value: fmtDur(p.totalIdleMs),           sub: p.idlePct != null ? `${p.idlePct}% of tracked time` : "none logged" },
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

    // ── Cataloguing vs Away split ──
    if (p.activePct != null && p.idlePct != null && (p.totalCatMs + p.totalIdleMs) > 0) {
      sectionTitle("Cataloguing vs time away")
      const barW = CONTENT_W
      const barH = 14
      const catW = barW * (p.activePct / 100)
      page.drawRectangle({ x: MARGIN, y: y - barH, width: barW, height: barH, color: FAINT })
      if (catW > 0)        page.drawRectangle({ x: MARGIN, y: y - barH, width: catW, height: barH, color: EMERALD })
      if (barW - catW > 0) page.drawRectangle({ x: MARGIN + catW, y: y - barH, width: barW - catW, height: barH, color: ORANGEB })
      y -= barH + 6
      page.drawRectangle({ x: MARGIN, y: y - 8, width: 8, height: 8, color: EMERALD })
      page.drawText(`${fmtDur(p.totalCatMs)} cataloguing (${p.activePct}%)`, { x: MARGIN + 12, y: y - 8, size: 8.5, font: helv, color: GREY })
      const awayX = MARGIN + 230
      page.drawRectangle({ x: awayX, y: y - 8, width: 8, height: 8, color: ORANGEB })
      page.drawText(`${fmtDur(p.totalIdleMs)} away (${p.idlePct}%)`, { x: awayX + 12, y: y - 8, size: 8.5, font: helv, color: GREY })
      y -= 20
    }

    // ── Speed / method / key points summary ──
    sectionTitle("Speed & method")
    page.drawText(`Average ${fmtDur(p.avgMs)}`, { x: MARGIN, y: y - 8, size: 9, font: helvB, color: INK })
    page.drawText(`Fastest ${fmtDur(p.fastestMs)}`, { x: MARGIN + 150, y: y - 8, size: 9, font: helv, color: GREEN })
    page.drawText(`Slowest ${fmtDur(p.slowestMs)}`, { x: MARGIN + 300, y: y - 8, size: 9, font: helv, color: RED })
    y -= 15
    page.drawText(`Wizard  ${p.wizardCount} lot${p.wizardCount === 1 ? "" : "s"} (avg ${fmtDur(p.wizardAvgMs)})`, { x: MARGIN, y: y - 8, size: 9, font: helv, color: BLUE })
    page.drawText(`Photo only  ${p.photoCount} lot${p.photoCount === 1 ? "" : "s"} (avg ${fmtDur(p.photoAvgMs)})`, { x: MARGIN + 250, y: y - 8, size: 9, font: helv, color: PURPLE })
    y -= 15
    if (p.kpCount > 0) {
      page.drawText(`Key points  avg ${fmtDur(p.kpAvgMs)}${p.kpPct > 0 ? ` (${p.kpPct}% of wizard time)` : ""}  ·  fastest ${fmtDur(p.kpFastMs)}  ·  slowest ${fmtDur(p.kpSlowMs)}  ·  ${p.kpCount} of ${p.wizardTracked} wizard lots`, { x: MARGIN, y: y - 8, size: 8.5, font: helv, color: GREY })
      y -= 15
    }
    if (p.researchMs > 0) {
      page.drawText(`Research  ${fmtDur(p.researchMs)} over ${p.researchSessions} session${p.researchSessions === 1 ? "" : "s"}`, { x: MARGIN, y: y - 8, size: 8.5, font: helv, color: GREY })
      y -= 15
    }
    y -= 6

    // ── By auction ──
    if (p.auctionStats.length) {
      sectionTitle("By auction")
      const cols: Col[] = [
        { title: "AUCTION",  x: MARGIN,        w: 320, align: "left"  },
        { title: "LOTS",     x: MARGIN + 330,  w: 60,  align: "right" },
        { title: "AVG TIME", x: MARGIN + 400,  w: 90,  align: "right" },
        { title: "FASTEST",  x: MARGIN + 500,  w: 90,  align: "right" },
        { title: "SLOWEST",  x: MARGIN + 600,  w: 90,  align: "right" },
      ]
      table(cols, p.auctionStats, 15, (a) => {
        page.drawText(truncate(a.code, helvB, 9, 70), { x: cols[0].x, y: y - 8, size: 9, font: helvB, color: INK })
        page.drawText(truncate(a.name, helv, 9, cols[0].w - 80), { x: cols[0].x + 76, y: y - 8, size: 9, font: helv, color: GREY })
        drawRight(String(a.count), cols[1].x + cols[1].w, y - 8, 9, helvB, INK)
        drawRight(fmtDur(a.avgMs), cols[2].x + cols[2].w, y - 8, 9, helv, GREY)
        drawRight(fmtDur(a.fastestMs), cols[3].x + cols[3].w, y - 8, 9, helv, GREEN)
        drawRight(fmtDur(a.slowestMs), cols[4].x + cols[4].w, y - 8, 9, helv, RED)
      })
      y -= 16
    }

    // ── Time away sessions (newest first, from-to) ──
    if (p.idle.length) {
      sectionTitle(`Time away sessions  (${p.idle.length})`)
      const cols: Col[] = [
        { title: "DATE",         x: MARGIN,        w: 74,  align: "left"  },
        { title: "TIME (FROM-TO)",x: MARGIN + 82,  w: 108, align: "left"  },
        { title: "REASON",       x: MARGIN + 198,  w: 150, align: "left"  },
        { title: "TOTES",        x: MARGIN + 356,  w: 80,  align: "left"  },
        { title: "NOTES",        x: MARGIN + 444,  w: 214, align: "left"  },
        { title: "DURATION",     x: MARGIN + 668,  w: CONTENT_W - 668, align: "right" },
      ]
      const sortedIdle = [...p.idle].sort((a, b) => b.ts.localeCompare(a.ts))
      table(cols, sortedIdle, 15, (l) => {
        const c = l.excluded ? MUTE : GREY
        const start = new Date(l.ts)
        page.drawText(fDate.format(start), { x: cols[0].x, y: y - 8, size: 8, font: helv, color: c })
        page.drawText(`${fHM.format(start)} - ${fHM.format(new Date(start.getTime() + l.durationMs))}`, { x: cols[1].x, y: y - 8, size: 8, font: helv, color: c })
        if (!l.excluded) swatch(cols[2].x, l.reasonKey)
        page.drawText(truncate(labelOf(l.reasonKey), helv, 9, cols[2].w - 14), { x: cols[2].x + 14, y: y - 8, size: 9, font: helv, color: l.excluded ? MUTE : INK })
        page.drawText(truncate(l.toteNumbers || "-", helv, 8, cols[3].w), { x: cols[3].x, y: y - 8, size: 8, font: helv, color: c })
        page.drawText(truncate(l.excluded ? "Excluded - over 10 hours" : (l.notes || "-"), helv, 8, cols[4].w), { x: cols[4].x, y: y - 8, size: 8, font: helv, color: c })
        drawRight(fmtDur(l.durationMs), cols[5].x + cols[5].w, y - 8, 9, helvB, l.excluded ? MUTE : ORANGE)
      })
      y -= 16
    }

    // ── Daily activity log (lots + time away, grouped per day) ──
    sectionTitle("Daily activity log")
    const logCols: Col[] = [
      { title: "TIME",              x: MARGIN,        w: 92,  align: "left"  },
      { title: "TYPE",              x: MARGIN + 96,   w: 40,  align: "left"  },
      { title: "DURATION",          x: MARGIN + 140,  w: 66,  align: "right" },
      { title: "DETAIL",            x: MARGIN + 214,  w: 132, align: "left"  },
      { title: "REF",               x: MARGIN + 352,  w: 116, align: "left"  },
      { title: "NOTES / KEY POINTS",x: MARGIN + 474,  w: 188, align: "left"  },
      { title: "AUCTION",           x: MARGIN + 668,  w: CONTENT_W - 668, align: "left" },
    ]

    // Group by London day, ascending (earliest first) — a natural chronological log.
    type DayGroup = { key: string; label: string; lots: PdfLotEntry[]; idle: PdfIdleEntry[] }
    const byDay = new Map<string, DayGroup>()
    const dayOf = (ts: string): DayGroup => {
      const k = fDayKey.format(new Date(ts))
      let g = byDay.get(k)
      if (!g) { g = { key: k, label: fDayLbl.format(new Date(ts)).replace(",", ""), lots: [], idle: [] }; byDay.set(k, g) }
      return g
    }
    for (const l of p.lots) dayOf(l.ts).lots.push(l)
    for (const i of p.idle) dayOf(i.ts).idle.push(i)
    const days = [...byDay.values()].sort((a, b) => a.key.localeCompare(b.key))

    drawHeaderRow(logCols)
    for (const d of days) {
      const dayLots  = [...d.lots].sort((a, b) => a.ts.localeCompare(b.ts))
      const dayIdle  = [...d.idle].sort((a, b) => a.ts.localeCompare(b.ts))
      const catMs    = dayLots.reduce((s, l) => s + l.durationMs, 0)
      const awayMs   = dayIdle.filter(i => !i.excluded).reduce((s, i) => s + i.durationMs, 0)

      // Day banner
      if (y - 16 < MARGIN + 24) { newPage(); drawHeaderRow(logCols) }
      page.drawRectangle({ x: MARGIN, y: y - 13, width: CONTENT_W, height: 14, color: BAND })
      page.drawText(safeAscii(d.label), { x: MARGIN + 6, y: y - 10, size: 8.5, font: helvB, color: INK })
      drawRight(`${dayLots.length} lot${dayLots.length === 1 ? "" : "s"}  ·  Cataloguing ${fmtDur(catMs)}  ·  Away ${fmtDur(awayMs)}`, PAGE_W - MARGIN - 6, y - 10, 8, helvB, GREY)
      y -= 18

      // Merge the day's rows in time order
      const rows: ({ t: "lot"; e: PdfLotEntry } | { t: "idle"; e: PdfIdleEntry })[] = [
        ...dayLots.map(e => ({ t: "lot" as const, e })),
        ...dayIdle.map(e => ({ t: "idle" as const, e })),
      ].sort((a, b) => a.e.ts.localeCompare(b.e.ts))

      for (const row of rows) {
        if (y - 13 < MARGIN + 24) { newPage(); drawHeaderRow(logCols) }
        if (row.t === "lot") {
          const e = row.e
          page.drawText(fTime.format(new Date(e.ts)), { x: logCols[0].x, y: y - 8, size: 8, font: helv, color: GREY })
          page.drawText("Lot", { x: logCols[1].x, y: y - 8, size: 8, font: helv, color: MUTE })
          drawRight(fmtDur(e.durationMs), logCols[2].x + logCols[2].w, y - 8, 8.5, helvB, INK)
          page.drawText(truncate(methodLabel(e.method), helv, 8, logCols[3].w), { x: logCols[3].x, y: y - 8, size: 8, font: helv, color: e.method === "WIZARD" ? BLUE : PURPLE })
          page.drawText(truncate(e.barcode || "-", helv, 8, logCols[4].w), { x: logCols[4].x, y: y - 8, size: 8, font: helv, color: GREY })
          page.drawText(truncate(e.keyPointsMs && e.keyPointsMs > 0 ? `Key points ${fmtDur(e.keyPointsMs)}` : "-", helv, 8, logCols[5].w), { x: logCols[5].x, y: y - 8, size: 8, font: helv, color: MUTE })
          page.drawText(truncate(`${e.auctionCode} ${e.auctionName}`, helv, 8, logCols[6].w), { x: logCols[6].x, y: y - 8, size: 8, font: helv, color: GREY })
        } else {
          const e = row.e
          const c = e.excluded ? MUTE : GREY
          const start = new Date(e.ts)
          page.drawText(`${fHM.format(start)} - ${fHM.format(new Date(start.getTime() + e.durationMs))}`, { x: logCols[0].x, y: y - 8, size: 8, font: helv, color: c })
          page.drawText("Away", { x: logCols[1].x, y: y - 8, size: 8, font: helvB, color: e.excluded ? MUTE : ORANGE })
          drawRight(fmtDur(e.durationMs), logCols[2].x + logCols[2].w, y - 8, 8.5, helvB, e.excluded ? MUTE : ORANGE)
          if (!e.excluded) swatch(logCols[3].x, e.reasonKey)
          page.drawText(truncate(labelOf(e.reasonKey), helv, 8, logCols[3].w - 14), { x: logCols[3].x + (e.excluded ? 0 : 14), y: y - 8, size: 8, font: helv, color: e.excluded ? MUTE : INK })
          page.drawText(truncate(e.toteNumbers || "-", helv, 8, logCols[4].w), { x: logCols[4].x, y: y - 8, size: 8, font: helv, color: c })
          page.drawText(truncate(e.excluded ? "Excluded - over 10 hours" : (e.notes || "-"), helv, 8, logCols[5].w), { x: logCols[5].x, y: y - 8, size: 8, font: helv, color: c })
          page.drawText(truncate(`${e.auctionCode} ${e.auctionName}`, helv, 8, logCols[6].w), { x: logCols[6].x, y: y - 8, size: 8, font: helv, color: c })
        }
        y -= 13
        page.drawLine({ start: { x: MARGIN, y }, end: { x: PAGE_W - MARGIN, y }, thickness: 0.3, color: FAINT })
      }
      y -= 8
    }
  })

  // ── Footer page numbers ──
  const pages = doc.getPages()
  pages.forEach((pg, i) => {
    pg.drawText("Vectis Auctions - Cataloguer Report", { x: MARGIN, y: MARGIN - 18, size: 7, font: helv, color: MUTE })
    const label = `Page ${i + 1} of ${pages.length}`
    pg.drawText(label, { x: PAGE_W - MARGIN - helv.widthOfTextAtSize(label, 7), y: MARGIN - 18, size: 7, font: helv, color: MUTE })
  })

  return await doc.save()
}
