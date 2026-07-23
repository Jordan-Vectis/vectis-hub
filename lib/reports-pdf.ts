// PDF renderer for the Cataloguing Performance reports.
//
// Two layouts, both A4 landscape and deliberately clean for managers — but still
// data-rich, and every figure is scoped to the SELECTED PERIOD (no "today"/"this
// week" columns that make no sense inside a 30-day report):
//
//   buildSummaryPdf      — the "Summary (PDF)" button: team headline stats, a
//                          ranked league table of every cataloguer (share of
//                          output, active days, speed, away %), then team-wide
//                          breakdowns — by auction, time away by reason, and
//                          daily output across the period.
//   buildIndividualsPdf  — one clean page per cataloguer: headline stats,
//                          cataloguing-vs-away split, speed & method, by-auction,
//                          away-by-reason and a per-day breakdown. Used by both
//                          "Export all" (everyone) and clicking a single name.
//
// The route does the DB work + aggregation (mirroring the on-screen pages so the
// numbers can't drift) and hands finished objects in here. Server-side pdf-lib.
import { PDFDocument, PDFPage, PDFImage, StandardFonts, PDFFont, rgb, RGB } from "pdf-lib"
import { embedVectisLogo } from "@/lib/pdf-logo"

// ─── Layout (A4 landscape) ──────────────────────────────────────────────────
const PAGE_W = 841.89
const PAGE_H = 595.28
const MARGIN = 36
const CONTENT_W = PAGE_W - MARGIN * 2
const RIGHT = PAGE_W - MARGIN

const INK     = rgb(0, 0, 0)
const GREY    = rgb(0.30, 0.30, 0.30)
const MUTE    = rgb(0.50, 0.50, 0.50)
const LINE    = rgb(0.80, 0.80, 0.80)
const FAINT   = rgb(0.92, 0.92, 0.92)
const ZEBRA   = rgb(0.972, 0.972, 0.972)
const RED     = rgb(0.79, 0.16, 0.16)
const GREEN   = rgb(0.13, 0.63, 0.42)
const TEAL    = rgb(0.165, 0.706, 0.651)
const BLUE    = rgb(0.23, 0.51, 0.96)
const PURPLE  = rgb(0.66, 0.33, 0.97)
const EMERALD = rgb(0.13, 0.70, 0.53)
const ORANGEB = rgb(0.98, 0.57, 0.24)

const UK_TZ = "Europe/London"

// ─── Public data shapes (pure — the route fills these) ──────────────────────
export type PdfReasonMeta = { label: string; idleColour: string }

/** One row of the team summary league table (all figures within the period). */
export type SummaryRow = {
  name: string
  lots: number
  activeDays: number
  dailyAvg: number
  avgMs: number
  fastestMs: number
  slowestMs: number
  catMs: number
  awayMs: number
  awayPct: number | null   // this person's away time as % of their tracked time
  researchMs: number
}

export type PdfAuctionStat = { code: string; name: string; count: number; avgMs: number; fastestMs: number; slowestMs: number }
export type PdfAwayReason  = { reasonKey: string; count: number; totalMs: number }
export type PdfDayRow      = { label: string; lots: number; catMs: number; awayMs: number }

/** Team-wide figures + breakdowns for the summary page. */
export type SummaryTeam = {
  rangeLabel: string
  totalLots: number
  avgMs: number
  fastestMs: number
  slowestMs: number
  cataloguers: number
  activeDays: number       // distinct days anyone catalogued in the period
  totalCatMs: number
  totalAwayMs: number
  researchMs: number
  byAuction: PdfAuctionStat[]
  byReason: PdfAwayReason[]
  byDay: PdfDayRow[]
}

export type PersonPdfReport = {
  userName: string
  hasData: boolean
  lotsInRange: number
  avgMs: number; fastestMs: number; slowestMs: number
  dailyAvg: number; completedDays: number
  totalCatMs: number; totalAwayMs: number
  activePct: number | null; idlePct: number | null
  wizardCount: number; wizardAvgMs: number
  photoCount: number;  photoAvgMs: number
  kpCount: number; wizardTracked: number
  kpAvgMs: number; kpFastMs: number; kpSlowMs: number; kpPct: number
  researchMs: number; researchSessions: number
  awaySessions: number
  auctionStats: PdfAuctionStat[]
  awayByReason: PdfAwayReason[]
  days: PdfDayRow[]
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

/** Human duration, e.g. "1h 22m 5s". Matches the on-screen reports (keeps seconds). */
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

function pctStr(n: number | null): string { return n == null ? "-" : `${n}%` }

type Col = { title: string; x: number; w: number; align: "left" | "right" }

// ─── Shared document context ────────────────────────────────────────────────
type Ctx = {
  doc: PDFDocument
  page: PDFPage
  y: number
  helv: PDFFont
  helvB: PDFFont
  logo: PDFImage
  printed: string
  eyebrow: string     // small caps line under the logo (report kind)
  rangeLabel: string
  heading: string     // big heading (person name, or "Team Summary")
  subnote: string     // extra right-aligned note under "Generated …"
}

async function mkCtx(eyebrow: string, rangeLabel: string): Promise<Ctx> {
  const doc = await PDFDocument.create()
  doc.setTitle(eyebrow)
  doc.setAuthor("Vectis Auctions")
  const helv  = await doc.embedFont(StandardFonts.Helvetica)
  const helvB = await doc.embedFont(StandardFonts.HelveticaBold)
  const logo  = await embedVectisLogo(doc)
  const printed = new Date().toLocaleString("en-GB", { timeZone: UK_TZ, weekday: "short", day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" })
  const page  = doc.addPage([PAGE_W, PAGE_H])
  return { doc, page, y: 0, helv, helvB, logo, printed, eyebrow, rangeLabel, heading: "", subnote: "" }
}

function drawRight(ctx: Ctx, text: string, rightX: number, yy: number, size: number, font: PDFFont, color: RGB): void {
  const s = safeAscii(text)
  ctx.page.drawText(s, { x: rightX - font.widthOfTextAtSize(s, size), y: yy, size, font, color })
}

function header(ctx: Ctx): void {
  const { page, logo, helv, helvB } = ctx
  const logoH = 30
  const logoW = logoH * (logo.width / logo.height)
  page.drawImage(logo, { x: MARGIN, y: PAGE_H - MARGIN - logoH, width: logoW, height: logoH })
  page.drawText(ctx.eyebrow, { x: MARGIN, y: PAGE_H - MARGIN - logoH - 13, size: 11, font: helvB, color: MUTE })
  if (ctx.heading) page.drawText(truncate(ctx.heading, helvB, 16, 460), { x: MARGIN, y: PAGE_H - MARGIN - logoH - 32, size: 16, font: helvB, color: INK })
  drawRight(ctx, `Period: ${ctx.rangeLabel}`, RIGHT, PAGE_H - MARGIN - 6, 10, helvB, INK)
  drawRight(ctx, `Generated ${ctx.printed}`, RIGHT, PAGE_H - MARGIN - 20, 8, helv, MUTE)
  if (ctx.subnote) drawRight(ctx, ctx.subnote, RIGHT, PAGE_H - MARGIN - 32, 8, helv, MUTE)
  ctx.y = PAGE_H - MARGIN - logoH - 42
  page.drawLine({ start: { x: MARGIN, y: ctx.y }, end: { x: RIGHT, y: ctx.y }, thickness: 1.2, color: INK })
  ctx.y -= 18
}

function newPage(ctx: Ctx): void { ctx.page = ctx.doc.addPage([PAGE_W, PAGE_H]); header(ctx) }
function ensure(ctx: Ctx, space: number): void { if (ctx.y - space < MARGIN + 26) newPage(ctx) }

function sectionTitle(ctx: Ctx, title: string): void {
  ensure(ctx, 34)
  ctx.page.drawText(safeAscii(title).toUpperCase(), { x: MARGIN, y: ctx.y - 9, size: 9, font: ctx.helvB, color: GREY })
  ctx.y -= 18
}

function statBoxes(ctx: Ctx, stats: { label: string; value: string; sub: string }[]): void {
  const gap = 12
  const boxW = (CONTENT_W - gap * (stats.length - 1)) / stats.length
  const boxH = 54
  ensure(ctx, boxH + 8)
  stats.forEach((s, i) => {
    const x = MARGIN + i * (boxW + gap)
    ctx.page.drawRectangle({ x, y: ctx.y - boxH, width: boxW, height: boxH, borderColor: LINE, borderWidth: 0.8, color: rgb(0.98, 0.98, 0.98) })
    ctx.page.drawRectangle({ x, y: ctx.y - boxH, width: 3, height: boxH, color: TEAL })
    ctx.page.drawText(safeAscii(s.label).toUpperCase(), { x: x + 10, y: ctx.y - 15, size: 7, font: ctx.helvB, color: MUTE })
    ctx.page.drawText(truncate(s.value, ctx.helvB, 17, boxW - 20), { x: x + 10, y: ctx.y - 35, size: 17, font: ctx.helvB, color: INK })
    ctx.page.drawText(truncate(s.sub, ctx.helv, 8, boxW - 20), { x: x + 10, y: ctx.y - 47, size: 8, font: ctx.helv, color: MUTE })
  })
  ctx.y -= boxH + 20
}

function drawHeaderRow(ctx: Ctx, cols: Col[]): void {
  for (const c of cols) {
    if (c.align === "right") drawRight(ctx, c.title, c.x + c.w, ctx.y - 8, 7, ctx.helvB, MUTE)
    else ctx.page.drawText(c.title, { x: c.x, y: ctx.y - 8, size: 7, font: ctx.helvB, color: MUTE })
  }
  ctx.page.drawLine({ start: { x: MARGIN, y: ctx.y - 12 }, end: { x: RIGHT, y: ctx.y - 12 }, thickness: 0.8, color: LINE })
  ctx.y -= 16
}

// Generic table with automatic page breaks; the column header redraws on each new
// page. drawRow paints one row at baseline (ctx.y - <n>) and must NOT advance y.
function table<T>(ctx: Ctx, cols: Col[], rows: T[], rowH: number, drawRow: (r: T, i: number) => void, zebra = false): void {
  drawHeaderRow(ctx, cols)
  rows.forEach((r, i) => {
    if (ctx.y - rowH < MARGIN + 26) { newPage(ctx); drawHeaderRow(ctx, cols) }
    if (zebra && i % 2 === 1) ctx.page.drawRectangle({ x: MARGIN, y: ctx.y - rowH, width: CONTENT_W, height: rowH, color: ZEBRA })
    drawRow(r, i)
    ctx.y -= rowH
    ctx.page.drawLine({ start: { x: MARGIN, y: ctx.y }, end: { x: RIGHT, y: ctx.y }, thickness: 0.3, color: FAINT })
  })
}

function footer(ctx: Ctx, label: string): void {
  const pages = ctx.doc.getPages()
  pages.forEach((pg, i) => {
    pg.drawText(label, { x: MARGIN, y: MARGIN - 18, size: 7, font: ctx.helv, color: MUTE })
    const n = `Page ${i + 1} of ${pages.length}`
    pg.drawText(n, { x: RIGHT - ctx.helv.widthOfTextAtSize(n, 7), y: MARGIN - 18, size: 7, font: ctx.helv, color: MUTE })
  })
}

// ─── Shared breakdown tables (used by both layouts) ─────────────────────────
function auctionTable(ctx: Ctx, stats: PdfAuctionStat[], title: string): void {
  if (!stats.length) return
  sectionTitle(ctx, `${title}  (${stats.length})`)
  const cols: Col[] = [
    { title: "AUCTION",  x: MARGIN,        w: 340, align: "left"  },
    { title: "LOTS",     x: MARGIN + 350,  w: 60,  align: "right" },
    { title: "AVG TIME", x: MARGIN + 420,  w: 100, align: "right" },
    { title: "FASTEST",  x: MARGIN + 530,  w: 100, align: "right" },
    { title: "SLOWEST",  x: MARGIN + 640,  w: CONTENT_W - 640, align: "right" },
  ]
  table(ctx, cols, stats, 15, (a) => {
    ctx.page.drawText(truncate(a.code, ctx.helvB, 9, 76), { x: cols[0].x, y: ctx.y - 8, size: 9, font: ctx.helvB, color: INK })
    ctx.page.drawText(truncate(a.name, ctx.helv, 9, cols[0].w - 84), { x: cols[0].x + 82, y: ctx.y - 8, size: 9, font: ctx.helv, color: GREY })
    drawRight(ctx, String(a.count),     cols[1].x + cols[1].w, ctx.y - 8, 9, ctx.helvB, INK)
    drawRight(ctx, fmtDur(a.avgMs),     cols[2].x + cols[2].w, ctx.y - 8, 9, ctx.helv, GREY)
    drawRight(ctx, fmtDur(a.fastestMs), cols[3].x + cols[3].w, ctx.y - 8, 9, ctx.helv, GREEN)
    drawRight(ctx, fmtDur(a.slowestMs), cols[4].x + cols[4].w, ctx.y - 8, 9, ctx.helv, RED)
  }, true)
  ctx.y -= 16
}

function reasonTable(ctx: Ctx, rows: PdfAwayReason[], title: string, labelOf: (k: string) => string, colourOf: (k: string) => RGB): void {
  if (!rows.length) return
  sectionTitle(ctx, title)
  const cols: Col[] = [
    { title: "REASON",     x: MARGIN,        w: 300, align: "left"  },
    { title: "SESSIONS",   x: MARGIN + 310,  w: 90,  align: "right" },
    { title: "TOTAL TIME", x: MARGIN + 410,  w: 120, align: "right" },
    { title: "SHARE",      x: MARGIN + 540,  w: CONTENT_W - 540, align: "right" },
  ]
  const totalAway = rows.reduce((s, r) => s + r.totalMs, 0) || 1
  const sorted = [...rows].sort((a, b) => b.totalMs - a.totalMs)
  table(ctx, cols, sorted, 15, (r) => {
    ctx.page.drawRectangle({ x: cols[0].x, y: ctx.y - 9, width: 8, height: 8, color: colourOf(r.reasonKey) })
    ctx.page.drawText(truncate(labelOf(r.reasonKey), ctx.helv, 9, cols[0].w - 14), { x: cols[0].x + 14, y: ctx.y - 8, size: 9, font: ctx.helv, color: INK })
    drawRight(ctx, String(r.count),   cols[1].x + cols[1].w, ctx.y - 8, 9, ctx.helv, GREY)
    drawRight(ctx, fmtDur(r.totalMs), cols[2].x + cols[2].w, ctx.y - 8, 9, ctx.helvB, ORANGEB)
    drawRight(ctx, `${Math.round((r.totalMs / totalAway) * 100)}%`, cols[3].x + cols[3].w, ctx.y - 8, 9, ctx.helv, MUTE)
  }, true)
  ctx.y -= 16
}

function dayTable(ctx: Ctx, days: PdfDayRow[], title: string): void {
  if (!days.length) return
  sectionTitle(ctx, `${title}  (${days.length} day${days.length === 1 ? "" : "s"})`)
  const cols: Col[] = [
    { title: "DAY",         x: MARGIN,        w: 220, align: "left"  },
    { title: "LOTS",        x: MARGIN + 230,  w: 70,  align: "right" },
    { title: "CATALOGUING", x: MARGIN + 310,  w: 150, align: "right" },
    { title: "TIME AWAY",   x: MARGIN + 470,  w: CONTENT_W - 470, align: "right" },
  ]
  table(ctx, cols, days, 15, (d) => {
    ctx.page.drawText(truncate(d.label, ctx.helvB, 9, cols[0].w), { x: cols[0].x, y: ctx.y - 8, size: 9, font: ctx.helvB, color: INK })
    drawRight(ctx, d.lots.toLocaleString(), cols[1].x + cols[1].w, ctx.y - 8, 9, ctx.helvB, INK)
    drawRight(ctx, fmtDur(d.catMs),  cols[2].x + cols[2].w, ctx.y - 8, 9, ctx.helv, EMERALD)
    drawRight(ctx, d.awayMs > 0 ? fmtDur(d.awayMs) : "-", cols[3].x + cols[3].w, ctx.y - 8, 9, ctx.helv, d.awayMs > 0 ? ORANGEB : MUTE)
  }, true)
  ctx.y -= 16
}

// ═══════════════════════════════════════════════════════════════════════════
//  Summary (team) — league table + team-wide breakdowns
// ═══════════════════════════════════════════════════════════════════════════
export async function buildSummaryPdf(rows: SummaryRow[], team: SummaryTeam, reasonMeta: Map<string, PdfReasonMeta>): Promise<Uint8Array> {
  const ctx = await mkCtx("Cataloguing Performance", team.rangeLabel)
  ctx.heading = "Team Summary"
  ctx.subnote = "All figures are for the selected period. Time away counts Mon-Fri, 9am-5pm."
  header(ctx)

  const labelOf  = (k: string) => reasonMeta.get(k)?.label ?? k
  const colourOf = (k: string) => hexToRgb(reasonMeta.get(k)?.idleColour ?? "#9ca3af")

  const tracked   = team.totalCatMs + team.totalAwayMs
  const activePct = tracked > 0 ? Math.round((team.totalCatMs / tracked) * 100) : null
  const awayPct   = activePct != null ? 100 - activePct : null

  statBoxes(ctx, [
    { label: "Total Lots",        value: team.totalLots.toLocaleString(), sub: `${team.cataloguers} cataloguer${team.cataloguers === 1 ? "" : "s"} · ${team.activeDays} active day${team.activeDays === 1 ? "" : "s"}` },
    { label: "Avg Time / Lot",    value: fmtDur(team.avgMs),              sub: `${fmtDur(team.fastestMs)} fastest · ${fmtDur(team.slowestMs)} slowest` },
    { label: "Cataloguing Time",  value: fmtDur(team.totalCatMs),         sub: activePct != null ? `${activePct}% of tracked time` : "active time logged" },
    { label: "Total Time Away",   value: fmtDur(team.totalAwayMs),        sub: awayPct != null ? `${awayPct}% of tracked time` : "none logged" },
  ])

  // ── Per-cataloguer league table (period-scoped columns only) ──
  sectionTitle(ctx, "Per cataloguer  (ranked by lots)")
  const cols: Col[] = [
    { title: "#",          x: MARGIN,        w: 16,  align: "left"  },
    { title: "CATALOGUER", x: MARGIN + 26,   w: 118, align: "left"  },
    { title: "LOTS",       x: MARGIN + 154,  w: 40,  align: "right" },
    { title: "SHARE",      x: MARGIN + 204,  w: 42,  align: "right" },
    { title: "DAYS",       x: MARGIN + 256,  w: 34,  align: "right" },
    { title: "AVG/DAY",    x: MARGIN + 300,  w: 48,  align: "right" },
    { title: "AVG TIME",   x: MARGIN + 358,  w: 64,  align: "right" },
    { title: "FASTEST",    x: MARGIN + 432,  w: 58,  align: "right" },
    { title: "SLOWEST",    x: MARGIN + 500,  w: 60,  align: "right" },
    { title: "AWAY",       x: MARGIN + 570,  w: 66,  align: "right" },
    { title: "AWAY %",     x: MARGIN + 646,  w: 44,  align: "right" },
    { title: "RESEARCH",   x: MARGIN + 700,  w: CONTENT_W - 700, align: "right" },
  ]
  const maxLots = rows.reduce((m, r) => Math.max(m, r.lots), 0)
  const nameCol = cols[1]
  const totalLots = team.totalLots || 1

  if (rows.length === 0) {
    ctx.page.drawText("No cataloguing activity in this period.", { x: MARGIN, y: ctx.y - 14, size: 11, font: ctx.helv, color: MUTE })
  } else {
    table(ctx, cols, rows, 21, (r, i) => {
      const yb = ctx.y - 9
      drawRight(ctx, String(i + 1), cols[0].x + cols[0].w, yb, 8, ctx.helv, MUTE)
      ctx.page.drawText(truncate(r.name, ctx.helvB, 9, nameCol.w), { x: nameCol.x, y: yb, size: 9, font: ctx.helvB, color: INK })
      if (maxLots > 0 && r.lots > 0) {
        const bw = Math.max(2, (nameCol.w - 2) * (r.lots / maxLots))
        ctx.page.drawRectangle({ x: nameCol.x, y: ctx.y - 15.5, width: bw, height: 2, color: TEAL })
      }
      drawRight(ctx, r.lots.toLocaleString(), cols[2].x + cols[2].w, yb, 9, ctx.helvB, INK)
      drawRight(ctx, `${Math.round((r.lots / totalLots) * 100)}%`, cols[3].x + cols[3].w, yb, 9, ctx.helv, TEAL)
      drawRight(ctx, r.activeDays ? String(r.activeDays) : "-", cols[4].x + cols[4].w, yb, 9, ctx.helv, GREY)
      drawRight(ctx, r.dailyAvg.toLocaleString(), cols[5].x + cols[5].w, yb, 9, ctx.helv, GREY)
      drawRight(ctx, fmtDur(r.avgMs),     cols[6].x + cols[6].w, yb, 9, ctx.helv, GREY)
      drawRight(ctx, fmtDur(r.fastestMs), cols[7].x + cols[7].w, yb, 9, ctx.helv, GREEN)
      drawRight(ctx, fmtDur(r.slowestMs), cols[8].x + cols[8].w, yb, 9, ctx.helv, RED)
      drawRight(ctx, fmtDur(r.awayMs),    cols[9].x + cols[9].w, yb, 9, ctx.helv, ORANGEB)
      drawRight(ctx, pctStr(r.awayPct),   cols[10].x + cols[10].w, yb, 9, ctx.helv, MUTE)
      drawRight(ctx, r.researchMs ? fmtDur(r.researchMs) : "-", cols[11].x + cols[11].w, yb, 9, ctx.helv, MUTE)
    }, true)

    // Team totals row
    if (ctx.y - 22 < MARGIN + 26) newPage(ctx)
    ctx.page.drawLine({ start: { x: MARGIN, y: ctx.y + 0.5 }, end: { x: RIGHT, y: ctx.y + 0.5 }, thickness: 1, color: INK })
    const yb = ctx.y - 12
    const sum = (f: (r: SummaryRow) => number) => rows.reduce((s, r) => s + f(r), 0)
    ctx.page.drawText("TEAM TOTAL", { x: cols[1].x, y: yb, size: 8.5, font: ctx.helvB, color: INK })
    drawRight(ctx, team.totalLots.toLocaleString(), cols[2].x + cols[2].w, yb, 9, ctx.helvB, INK)
    drawRight(ctx, "100%", cols[3].x + cols[3].w, yb, 9, ctx.helvB, TEAL)
    drawRight(ctx, team.activeDays ? String(team.activeDays) : "-", cols[4].x + cols[4].w, yb, 9, ctx.helvB, GREY)
    drawRight(ctx, "-", cols[5].x + cols[5].w, yb, 9, ctx.helv, MUTE)
    drawRight(ctx, fmtDur(team.avgMs),     cols[6].x + cols[6].w, yb, 9, ctx.helvB, GREY)
    drawRight(ctx, fmtDur(team.fastestMs), cols[7].x + cols[7].w, yb, 9, ctx.helvB, GREEN)
    drawRight(ctx, fmtDur(team.slowestMs), cols[8].x + cols[8].w, yb, 9, ctx.helvB, RED)
    drawRight(ctx, fmtDur(team.totalAwayMs), cols[9].x + cols[9].w, yb, 9, ctx.helvB, ORANGEB)
    drawRight(ctx, pctStr(awayPct), cols[10].x + cols[10].w, yb, 9, ctx.helvB, MUTE)
    drawRight(ctx, fmtDur(sum(r => r.researchMs)), cols[11].x + cols[11].w, yb, 9, ctx.helvB, MUTE)
    ctx.y -= 26
  }

  // ── Team-wide breakdowns ──
  auctionTable(ctx, team.byAuction, "Team - by auction")
  reasonTable(ctx, team.byReason, "Team - time away by reason", labelOf, colourOf)
  dayTable(ctx, team.byDay, "Team - daily output")

  footer(ctx, "Vectis Auctions - Cataloguing Performance Summary")
  return await ctx.doc.save()
}

// ═══════════════════════════════════════════════════════════════════════════
//  Individuals — one clean, detailed page per cataloguer
// ═══════════════════════════════════════════════════════════════════════════
export async function buildIndividualsPdf(
  persons: PersonPdfReport[],
  rangeLabel: string,
  reasonMeta: Map<string, PdfReasonMeta>,
): Promise<Uint8Array> {
  const ctx = await mkCtx("Cataloguer Report", rangeLabel)
  ctx.subnote = "Time away counts Mon-Fri, 9am-5pm only"

  const labelOf  = (k: string) => reasonMeta.get(k)?.label ?? k
  const colourOf = (k: string) => hexToRgb(reasonMeta.get(k)?.idleColour ?? "#9ca3af")

  persons.forEach((p, personIdx) => {
    ctx.heading = p.userName
    if (personIdx === 0) header(ctx); else newPage(ctx)

    if (!p.hasData) {
      ctx.page.drawText("No lots or time away logged in this period.", { x: MARGIN, y: ctx.y - 20, size: 11, font: ctx.helv, color: MUTE })
      return
    }

    // ── Headline stat boxes ──
    statBoxes(ctx, [
      { label: "Lots in Range",   value: p.lotsInRange.toLocaleString(), sub: rangeLabel },
      { label: "Avg Time / Lot",  value: fmtDur(p.avgMs),                sub: `${fmtDur(p.fastestMs)} fastest · ${fmtDur(p.slowestMs)} slowest` },
      { label: "Daily Average",   value: p.dailyAvg.toLocaleString(),    sub: p.completedDays > 0 ? `over ${p.completedDays} full day${p.completedDays === 1 ? "" : "s"}` : "today only" },
      { label: "Total Time Away", value: fmtDur(p.totalAwayMs),          sub: p.idlePct != null ? `${p.idlePct}% of tracked time` : "none logged" },
    ])

    // ── Cataloguing vs away split ──
    if (p.activePct != null && p.idlePct != null && (p.totalCatMs + p.totalAwayMs) > 0) {
      sectionTitle(ctx, "Cataloguing vs time away")
      const barH = 14
      const catW = CONTENT_W * (p.activePct / 100)
      ctx.page.drawRectangle({ x: MARGIN, y: ctx.y - barH, width: CONTENT_W, height: barH, color: FAINT })
      if (catW > 0)             ctx.page.drawRectangle({ x: MARGIN, y: ctx.y - barH, width: catW, height: barH, color: EMERALD })
      if (CONTENT_W - catW > 0) ctx.page.drawRectangle({ x: MARGIN + catW, y: ctx.y - barH, width: CONTENT_W - catW, height: barH, color: ORANGEB })
      ctx.y -= barH + 6
      ctx.page.drawRectangle({ x: MARGIN, y: ctx.y - 8, width: 8, height: 8, color: EMERALD })
      ctx.page.drawText(`${fmtDur(p.totalCatMs)} cataloguing (${p.activePct}%)`, { x: MARGIN + 12, y: ctx.y - 8, size: 8.5, font: ctx.helv, color: GREY })
      const awayX = MARGIN + 240
      ctx.page.drawRectangle({ x: awayX, y: ctx.y - 8, width: 8, height: 8, color: ORANGEB })
      ctx.page.drawText(`${fmtDur(p.totalAwayMs)} away (${p.idlePct}%)`, { x: awayX + 12, y: ctx.y - 8, size: 8.5, font: ctx.helv, color: GREY })
      ctx.y -= 20
    }

    // ── Speed & method ──
    sectionTitle(ctx, "Speed & method")
    ctx.page.drawText(`Average ${fmtDur(p.avgMs)}`,  { x: MARGIN,       y: ctx.y - 8, size: 9, font: ctx.helvB, color: INK })
    ctx.page.drawText(`Fastest ${fmtDur(p.fastestMs)}`, { x: MARGIN + 150, y: ctx.y - 8, size: 9, font: ctx.helv, color: GREEN })
    ctx.page.drawText(`Slowest ${fmtDur(p.slowestMs)}`, { x: MARGIN + 300, y: ctx.y - 8, size: 9, font: ctx.helv, color: RED })
    ctx.y -= 15
    ctx.page.drawText(`Wizard  ${p.wizardCount} lot${p.wizardCount === 1 ? "" : "s"} (avg ${fmtDur(p.wizardAvgMs)})`, { x: MARGIN, y: ctx.y - 8, size: 9, font: ctx.helv, color: BLUE })
    ctx.page.drawText(`Photo only  ${p.photoCount} lot${p.photoCount === 1 ? "" : "s"} (avg ${fmtDur(p.photoAvgMs)})`, { x: MARGIN + 250, y: ctx.y - 8, size: 9, font: ctx.helv, color: PURPLE })
    ctx.y -= 15
    if (p.kpCount > 0) {
      ctx.page.drawText(`Key points  avg ${fmtDur(p.kpAvgMs)}${p.kpPct > 0 ? ` (${p.kpPct}% of wizard time)` : ""}  ·  fastest ${fmtDur(p.kpFastMs)}  ·  slowest ${fmtDur(p.kpSlowMs)}  ·  ${p.kpCount} of ${p.wizardTracked} wizard lots`, { x: MARGIN, y: ctx.y - 8, size: 8.5, font: ctx.helv, color: GREY })
      ctx.y -= 15
    }
    if (p.researchMs > 0) {
      ctx.page.drawText(`Research  ${fmtDur(p.researchMs)} over ${p.researchSessions} session${p.researchSessions === 1 ? "" : "s"}`, { x: MARGIN, y: ctx.y - 8, size: 8.5, font: ctx.helv, color: GREY })
      ctx.y -= 15
    }
    ctx.y -= 6

    auctionTable(ctx, p.auctionStats, "By auction")
    reasonTable(ctx, p.awayByReason, "Time away by reason", labelOf, colourOf)
    dayTable(ctx, p.days, "Daily breakdown")
  })

  footer(ctx, "Vectis Auctions - Cataloguer Report")
  return await ctx.doc.save()
}
