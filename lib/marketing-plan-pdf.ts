// PDF renderer for a Marketing Business Plan (Marketing Reports → Business Plan).
//
// A4 PORTRAIT, unlike the landscape cataloguing reports — this reads as a
// document (prose, objectives, a channel-by-channel action list), not a wide
// data table. Server-side pdf-lib throughout (RULES: never pdfkit).
//
// Everything printed comes from the plan's FROZEN snapshot, so the figures on
// the page are the ones the plan was written against — printing it six weeks
// later must not silently restate today's traffic.

import { PDFDocument, PDFPage, PDFImage, StandardFonts, PDFFont, rgb, RGB } from "pdf-lib"
import { embedVectisLogo } from "@/lib/pdf-logo"
import { fmtNum, PLAN_CHANNELS, type PlanSnapshot } from "@/lib/marketing-plan"

// ─── Layout (A4 portrait) ───────────────────────────────────────────────────
const PAGE_W = 595.28
const PAGE_H = 841.89
const MARGIN = 42
const CONTENT_W = PAGE_W - MARGIN * 2
const RIGHT = PAGE_W - MARGIN

const INK   = rgb(0, 0, 0)
const GREY  = rgb(0.30, 0.30, 0.30)
const MUTE  = rgb(0.50, 0.50, 0.50)
const LINE  = rgb(0.80, 0.80, 0.80)
const FAINT = rgb(0.92, 0.92, 0.92)
const ZEBRA = rgb(0.972, 0.972, 0.972)
const PINK  = rgb(0.859, 0.153, 0.467)   // the page's own accent
const GREEN = rgb(0.13, 0.63, 0.42)
const RED   = rgb(0.79, 0.16, 0.16)

const UK_TZ = "Europe/London"

export type PdfPlanObjective = {
  title: string; metric: string | null; baseline: string | null
  target: string | null; dueBy: string | null; notes: string | null; source: string
}
export type PdfPlanAction = {
  channel: string; title: string; detail: string | null; owner: string | null
  dueBy: string | null; effort: string | null; impact: string | null; status: string; source: string
}
export type PdfPlan = {
  name: string
  periodLabel: string | null
  status: string
  createdBy: string | null
  summary: string | null
  audience: string | null
  competitors: string | null
  snapshot: PlanSnapshot | null
  objectives: PdfPlanObjective[]
  actions: PdfPlanAction[]
}

// ─── Small helpers ──────────────────────────────────────────────────────────
// pdf-lib's StandardFonts are WinAnsi only — strip anything they can't draw.
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

/** Greedy word wrap. Returns the lines; the caller decides where they go. */
function wrap(text: string, font: PDFFont, size: number, maxW: number): string[] {
  const out: string[] = []
  for (const para of safeAscii(text).split(/\n+/)) {
    let line = ""
    for (const word of para.split(/\s+/).filter(Boolean)) {
      const next = line ? `${line} ${word}` : word
      if (font.widthOfTextAtSize(next, size) <= maxW) { line = next; continue }
      if (line) out.push(line)
      // A single word longer than the column would loop forever — hard-cut it.
      line = font.widthOfTextAtSize(word, size) > maxW ? truncate(word, font, size, maxW) : word
    }
    if (line) out.push(line)
  }
  return out
}

type Col = { title: string; x: number; w: number; align: "left" | "right" }

type Ctx = {
  doc: PDFDocument
  page: PDFPage
  y: number
  helv: PDFFont
  helvB: PDFFont
  helvI: PDFFont
  logo: PDFImage
  printed: string
  planName: string
  periodLine: string
}

function drawRight(ctx: Ctx, text: string, rightX: number, yy: number, size: number, font: PDFFont, color: RGB): void {
  const s = safeAscii(text)
  ctx.page.drawText(s, { x: rightX - font.widthOfTextAtSize(s, size), y: yy, size, font, color })
}

function header(ctx: Ctx): void {
  const { page, logo, helv, helvB } = ctx
  const logoH = 26
  const logoW = logoH * (logo.width / logo.height)
  page.drawImage(logo, { x: MARGIN, y: PAGE_H - MARGIN - logoH, width: logoW, height: logoH })
  page.drawText("Marketing Business Plan", { x: MARGIN, y: PAGE_H - MARGIN - logoH - 12, size: 9, font: helvB, color: MUTE })
  page.drawText(truncate(ctx.planName, helvB, 15, CONTENT_W - 170), { x: MARGIN, y: PAGE_H - MARGIN - logoH - 31, size: 15, font: helvB, color: INK })
  if (ctx.periodLine) drawRight(ctx, ctx.periodLine, RIGHT, PAGE_H - MARGIN - 6, 9, helvB, INK)
  drawRight(ctx, `Generated ${ctx.printed}`, RIGHT, PAGE_H - MARGIN - 19, 7.5, helv, MUTE)
  ctx.y = PAGE_H - MARGIN - logoH - 41
  page.drawLine({ start: { x: MARGIN, y: ctx.y }, end: { x: RIGHT, y: ctx.y }, thickness: 1.2, color: INK })
  ctx.y -= 18
}

function newPage(ctx: Ctx): void { ctx.page = ctx.doc.addPage([PAGE_W, PAGE_H]); header(ctx) }
function ensure(ctx: Ctx, space: number): void { if (ctx.y - space < MARGIN + 26) newPage(ctx) }

function sectionTitle(ctx: Ctx, title: string): void {
  ensure(ctx, 40)
  ctx.page.drawRectangle({ x: MARGIN, y: ctx.y - 12, width: 3, height: 11, color: PINK })
  ctx.page.drawText(safeAscii(title).toUpperCase(), { x: MARGIN + 9, y: ctx.y - 10, size: 9, font: ctx.helvB, color: GREY })
  ctx.y -= 20
}

/** Body prose with page breaks. Empty text draws a muted placeholder rather
 *  than nothing, so a blank section reads as "not filled in", not as an error. */
function paragraph(ctx: Ctx, text: string | null, placeholder: string): void {
  const size = 9.5
  const lead = 13
  if (!text || !text.trim()) {
    ensure(ctx, lead + 6)
    ctx.page.drawText(safeAscii(placeholder), { x: MARGIN, y: ctx.y - 9, size, font: ctx.helvI, color: MUTE })
    ctx.y -= lead + 8
    return
  }
  for (const line of wrap(text, ctx.helv, size, CONTENT_W)) {
    ensure(ctx, lead)
    ctx.page.drawText(line, { x: MARGIN, y: ctx.y - 9, size, font: ctx.helv, color: INK })
    ctx.y -= lead
  }
  ctx.y -= 8
}

function drawHeaderRow(ctx: Ctx, cols: Col[]): void {
  for (const c of cols) {
    if (c.align === "right") drawRight(ctx, c.title, c.x + c.w, ctx.y - 8, 6.5, ctx.helvB, MUTE)
    else ctx.page.drawText(c.title, { x: c.x, y: ctx.y - 8, size: 6.5, font: ctx.helvB, color: MUTE })
  }
  ctx.page.drawLine({ start: { x: MARGIN, y: ctx.y - 12 }, end: { x: RIGHT, y: ctx.y - 12 }, thickness: 0.8, color: LINE })
  ctx.y -= 16
}

/** Variable-height table: measure() gives each row's height so a wrapped detail
 *  line can't overprint the row beneath it. */
function table<T>(
  ctx: Ctx,
  cols: Col[],
  rows: T[],
  measure: (r: T) => number,
  drawRow: (r: T, h: number) => void,
  zebra = true,
): void {
  drawHeaderRow(ctx, cols)
  rows.forEach((r, i) => {
    const h = measure(r)
    if (ctx.y - h < MARGIN + 26) { newPage(ctx); drawHeaderRow(ctx, cols) }
    if (zebra && i % 2 === 1) ctx.page.drawRectangle({ x: MARGIN, y: ctx.y - h, width: CONTENT_W, height: h, color: ZEBRA })
    drawRow(r, h)
    ctx.y -= h
    ctx.page.drawLine({ start: { x: MARGIN, y: ctx.y }, end: { x: RIGHT, y: ctx.y }, thickness: 0.3, color: FAINT })
  })
  ctx.y -= 14
}

function footer(ctx: Ctx, label: string): void {
  const pages = ctx.doc.getPages()
  pages.forEach((pg, i) => {
    pg.drawText(safeAscii(label), { x: MARGIN, y: MARGIN - 20, size: 7, font: ctx.helv, color: MUTE })
    const n = `Page ${i + 1} of ${pages.length}`
    pg.drawText(n, { x: RIGHT - ctx.helv.widthOfTextAtSize(n, 7), y: MARGIN - 20, size: 7, font: ctx.helv, color: MUTE })
  })
}

// ─── Where we are now ───────────────────────────────────────────────────────
function statBoxes(ctx: Ctx, snap: PlanSnapshot): void {
  const perRow = 3
  const gap = 10
  const boxW = (CONTENT_W - gap * (perRow - 1)) / perRow
  const boxH = 48
  for (let i = 0; i < snap.stats.length; i += perRow) {
    const row = snap.stats.slice(i, i + perRow)
    ensure(ctx, boxH + 8)
    row.forEach((s, j) => {
      const x = MARGIN + j * (boxW + gap)
      ctx.page.drawRectangle({ x, y: ctx.y - boxH, width: boxW, height: boxH, borderColor: LINE, borderWidth: 0.8, color: rgb(0.98, 0.98, 0.98) })
      ctx.page.drawRectangle({ x, y: ctx.y - boxH, width: 3, height: boxH, color: PINK })
      ctx.page.drawText(truncate(s.label.toUpperCase(), ctx.helvB, 6.5, boxW - 18), { x: x + 9, y: ctx.y - 14, size: 6.5, font: ctx.helvB, color: MUTE })
      ctx.page.drawText(truncate(s.value, ctx.helvB, 15, boxW - 18), { x: x + 9, y: ctx.y - 32, size: 15, font: ctx.helvB, color: INK })
      const d = s.delta
      const txt = d === null || !isFinite(d) ? "no comparison" : `${d >= 0 ? "up" : "down"} ${Math.abs(d * 100).toFixed(1)}%`
      const col = d === null || !isFinite(d) ? MUTE : d >= 0 ? GREEN : RED
      ctx.page.drawText(truncate(txt, ctx.helv, 7, boxW - 18), { x: x + 9, y: ctx.y - 42, size: 7, font: ctx.helv, color: col })
    })
    ctx.y -= boxH + gap
  }
  ctx.y -= 6
}

/** The breakdown tables, two side by side to keep the plan short. */
function breakdowns(ctx: Ctx, snap: PlanSnapshot): void {
  const withRows = snap.sections.filter((s) => s.rows.length > 0)
  if (withRows.length === 0) return
  const gap = 16
  const colW = (CONTENT_W - gap) / 2
  const rowH = 11
  const size = 7.5

  for (let i = 0; i < withRows.length; i += 2) {
    const pair = withRows.slice(i, i + 2)
    const tallest = Math.max(...pair.map((s) => Math.min(s.rows.length, 6)))
    const blockH = 16 + tallest * rowH + 10
    ensure(ctx, blockH)
    const top = ctx.y
    pair.forEach((sec, j) => {
      const x = MARGIN + j * (colW + gap)
      ctx.page.drawText(truncate(sec.title.toUpperCase(), ctx.helvB, 6.5, colW), { x, y: top - 8, size: 6.5, font: ctx.helvB, color: PINK })
      ctx.page.drawLine({ start: { x, y: top - 12 }, end: { x: x + colW, y: top - 12 }, thickness: 0.5, color: LINE })
      sec.rows.slice(0, 6).forEach((r, k) => {
        const yy = top - 22 - k * rowH
        const valTxt = `${fmtNum(r.value)}`
        const valW = ctx.helvB.widthOfTextAtSize(valTxt, size)
        ctx.page.drawText(truncate(r.name, ctx.helv, size, colW - valW - 8), { x, y: yy, size, font: ctx.helv, color: GREY })
        ctx.page.drawText(valTxt, { x: x + colW - valW, y: yy, size, font: ctx.helvB, color: INK })
      })
    })
    ctx.y = top - blockH
  }
  ctx.y -= 6
}

// ═══════════════════════════════════════════════════════════════════════════
export async function buildMarketingPlanPdf(plan: PdfPlan, now: Date = new Date()): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  doc.setTitle(`Marketing Business Plan — ${plan.name}`)
  doc.setAuthor("Vectis Auctions")

  const helv  = await doc.embedFont(StandardFonts.Helvetica)
  const helvB = await doc.embedFont(StandardFonts.HelveticaBold)
  const helvI = await doc.embedFont(StandardFonts.HelveticaOblique)
  const logo  = await embedVectisLogo(doc)
  const printed = now.toLocaleString("en-GB", { timeZone: UK_TZ, weekday: "short", day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" })

  const ctx: Ctx = {
    doc, page: doc.addPage([PAGE_W, PAGE_H]), y: 0, helv, helvB, helvI, logo, printed,
    planName: plan.name,
    periodLine: plan.periodLabel ?? plan.snapshot?.rangeLabel ?? "",
  }
  header(ctx)

  // Provenance line — a plan is only as good as the figures behind it, so say
  // plainly when they were taken and what they covered.
  const snap = plan.snapshot
  const scope = snap
    ? [snap.ukOnly ? "UK visitors only" : null, snap.excludeBots ? "bot-heavy countries excluded" : null]
        .filter(Boolean).join(", ") || "all traffic"
    : ""
  const provenance = snap
    ? `Figures: Google Analytics, ${snap.rangeLabel.toLowerCase()} (${scope}), taken ${new Date(snap.takenAt).toLocaleString("en-GB", { timeZone: UK_TZ, day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" })}.`
    : "No analytics figures were attached to this plan."
  const meta = [plan.status, plan.createdBy ? `Written by ${plan.createdBy}` : null].filter(Boolean).join(" · ")
  ctx.page.drawText(truncate(provenance, helv, 7.5, CONTENT_W), { x: MARGIN, y: ctx.y - 6, size: 7.5, font: helv, color: MUTE })
  ctx.y -= 12
  if (meta) { ctx.page.drawText(truncate(meta, helv, 7.5, CONTENT_W), { x: MARGIN, y: ctx.y - 6, size: 7.5, font: helv, color: MUTE }); ctx.y -= 12 }
  ctx.y -= 8

  // ── 1. Where we are now ──
  sectionTitle(ctx, "Where we are now")
  paragraph(ctx, plan.summary, "No summary written yet.")
  if (snap) { statBoxes(ctx, snap); breakdowns(ctx, snap) }

  // ── 2. Objectives & KPIs ──
  sectionTitle(ctx, `Objectives & KPIs  (${plan.objectives.length})`)
  if (plan.objectives.length === 0) {
    paragraph(ctx, null, "No objectives set yet.")
  } else {
    const cols: Col[] = [
      { title: "OBJECTIVE", x: MARGIN,       w: 232, align: "left"  },
      { title: "MEASURED ON", x: MARGIN + 240, w: 92,  align: "left"  },
      { title: "NOW",       x: MARGIN + 338, w: 56,  align: "right" },
      { title: "TARGET",    x: MARGIN + 400, w: 56,  align: "right" },
      { title: "BY",        x: MARGIN + 462, w: CONTENT_W - 462, align: "right" },
    ]
    table(ctx, cols, plan.objectives,
      (o) => {
        const lines = o.notes ? wrap(o.notes, helv, 7.5, cols[0].w).length : 0
        return Math.max(17, 13 + wrap(o.title, helvB, 9, cols[0].w).length * 11 + lines * 9)
      },
      (o, h) => {
        let ty = ctx.y - 10
        for (const line of wrap(o.title, helvB, 9, cols[0].w)) {
          ctx.page.drawText(line, { x: cols[0].x, y: ty, size: 9, font: helvB, color: INK })
          ty -= 11
        }
        if (o.notes) {
          for (const line of wrap(o.notes, helv, 7.5, cols[0].w)) {
            ctx.page.drawText(line, { x: cols[0].x, y: ty, size: 7.5, font: helv, color: MUTE })
            ty -= 9
          }
        }
        ctx.page.drawText(truncate(o.metric ?? "-", helv, 8, cols[1].w), { x: cols[1].x, y: ctx.y - 10, size: 8, font: helv, color: GREY })
        drawRight(ctx, o.baseline ?? "-", cols[2].x + cols[2].w, ctx.y - 10, 8, helv, GREY)
        drawRight(ctx, o.target ?? "-",   cols[3].x + cols[3].w, ctx.y - 10, 8.5, helvB, PINK)
        drawRight(ctx, o.dueBy ?? "-",    cols[4].x + cols[4].w, ctx.y - 10, 8, helv, GREY)
        if (o.source === "ai") ctx.page.drawText("AI", { x: RIGHT - 10, y: ctx.y - h + 5, size: 5.5, font: helvB, color: LINE })
      })
  }

  // ── 3. Channel plan ──
  sectionTitle(ctx, `Channel plan  (${plan.actions.length} action${plan.actions.length === 1 ? "" : "s"})`)
  if (plan.actions.length === 0) {
    paragraph(ctx, null, "No actions added yet.")
  } else {
    const cols: Col[] = [
      { title: "ACTION",  x: MARGIN,       w: 296, align: "left"  },
      { title: "OWNER",   x: MARGIN + 304, w: 78,  align: "left"  },
      { title: "BY",      x: MARGIN + 388, w: 62,  align: "left"  },
      { title: "EFFORT",  x: MARGIN + 456, w: 26,  align: "right" },
      { title: "IMPACT",  x: MARGIN + 488, w: 23,  align: "right" },
    ]
    // Grouped by channel, in the catalog's order, so the plan reads channel by
    // channel rather than in the order things happened to be typed.
    for (const ch of PLAN_CHANNELS) {
      const rows = plan.actions.filter((a) => a.channel === ch.key)
      if (rows.length === 0) continue
      ensure(ctx, 46)
      ctx.page.drawText(safeAscii(ch.label), { x: MARGIN, y: ctx.y - 9, size: 10, font: helvB, color: PINK })
      ctx.y -= 16
      table(ctx, cols, rows,
        (a) => {
          const t = wrap(a.title, helvB, 8.5, cols[0].w).length * 10.5
          const d = a.detail ? wrap(a.detail, helv, 7.5, cols[0].w).length * 9 : 0
          return Math.max(17, 8 + t + d)
        },
        (a, h) => {
          let ty = ctx.y - 10
          const done = a.status === "DONE"
          for (const line of wrap(a.title, helvB, 8.5, cols[0].w)) {
            ctx.page.drawText(line, { x: cols[0].x, y: ty, size: 8.5, font: helvB, color: done ? MUTE : INK })
            ty -= 10.5
          }
          if (a.detail) {
            for (const line of wrap(a.detail, helv, 7.5, cols[0].w)) {
              ctx.page.drawText(line, { x: cols[0].x, y: ty, size: 7.5, font: helv, color: MUTE })
              ty -= 9
            }
          }
          ctx.page.drawText(truncate(a.owner ?? "-", helv, 8, cols[1].w), { x: cols[1].x, y: ctx.y - 10, size: 8, font: helv, color: GREY })
          ctx.page.drawText(truncate(a.dueBy ?? "-", helv, 8, cols[2].w), { x: cols[2].x, y: ctx.y - 10, size: 8, font: helv, color: GREY })
          drawRight(ctx, a.effort ?? "-", cols[3].x + cols[3].w, ctx.y - 10, 7.5, helv, GREY)
          drawRight(ctx, a.impact ?? "-", cols[4].x + cols[4].w, ctx.y - 10, 7.5, helvB, GREY)
          const badge = done ? "DONE" : a.status === "DOING" ? "IN PROGRESS" : ""
          if (badge) ctx.page.drawText(badge, { x: cols[0].x, y: ctx.y - h + 5, size: 5.5, font: helvB, color: done ? GREEN : PINK })
        })
    }
  }

  // ── 4. Audience & competitors ──
  sectionTitle(ctx, "Audience")
  paragraph(ctx, plan.audience, "No audience notes written yet.")
  sectionTitle(ctx, "Competitors")
  paragraph(ctx, plan.competitors, "No competitor notes written yet.")

  footer(ctx, `Vectis Auctions - Marketing Business Plan - ${plan.name}${plan.periodLabel ? ` (${plan.periodLabel})` : ""}`)
  return doc.save()
}
