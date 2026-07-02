// PDF renderer for the BC Warehouse guide (one section per document).
// Content comes from lib/bc-warehouse-guide.ts — the same source the 📖 Guide
// tab renders — so the on-screen guide and the printed guide always match.
// pdf-lib only (pure JS, serverless-safe); logo via the shared sharp helper.

import { PDFDocument, StandardFonts, PDFFont, PDFPage, rgb } from "pdf-lib"
import { embedVectisLogo } from "./pdf-logo"
import type { GuideSection } from "./bc-warehouse-guide"

// A4 portrait, points
const PAGE_W    = 595.28
const PAGE_H    = 841.89
const MARGIN    = 48
const CONTENT_W = PAGE_W - MARGIN * 2

const BLACK = rgb(0, 0, 0)
const GREY  = rgb(0.35, 0.35, 0.35)
const LITE  = rgb(0.6, 0.6, 0.6)
const BLUE  = rgb(0.15, 0.3, 0.6)
const AMBER = rgb(0.6, 0.4, 0.05)
const LINE  = rgb(0.85, 0.85, 0.85)

type Fonts = { helv: PDFFont; helvB: PDFFont }
type Color = ReturnType<typeof rgb>

// Cursor-based writer: tracks the current page + y, adds pages as content flows.
class Writer {
  page!: PDFPage
  y = 0
  private doc: PDFDocument
  private fonts: Fonts
  private headerText: string
  constructor(doc: PDFDocument, fonts: Fonts, headerText: string) {
    this.doc = doc
    this.fonts = fonts
    this.headerText = headerText
    this.newPage()
  }
  newPage() {
    this.page = this.doc.addPage([PAGE_W, PAGE_H])
    this.y = PAGE_H - MARGIN
    // Running header on continuation pages (the first page draws its own banner)
    if (this.doc.getPageCount() > 1) {
      this.page.drawText(safeText(this.headerText), { x: MARGIN, y: PAGE_H - 28, size: 8, font: this.fonts.helv, color: LITE })
      this.page.drawLine({ start: { x: MARGIN, y: PAGE_H - 34 }, end: { x: PAGE_W - MARGIN, y: PAGE_H - 34 }, thickness: 0.5, color: LINE })
      this.y = PAGE_H - 52
    }
  }
  ensure(height: number) {
    if (this.y - height < MARGIN) this.newPage()
  }
  gap(h: number) { this.y -= h }
  // Draw wrapped text; optional hanging bullet ("•" / "1.") kept with the first line.
  text(text: string, opts: { size: number; font: PDFFont; color?: Color; indent?: number; lineGap?: number; hangingBullet?: string }) {
    const { size, font } = opts
    const color = opts.color ?? BLACK
    const indent = opts.indent ?? 0
    const lineH = size + (opts.lineGap ?? 3)
    const bullet = opts.hangingBullet
    const bulletW = bullet ? font.widthOfTextAtSize(safeText(bullet) + "  ", size) : 0
    const maxW = CONTENT_W - indent - bulletW
    const lines = wrapText(text, font, size, maxW)
    this.ensure(lineH)
    if (bullet) {
      this.page.drawText(safeText(bullet), { x: MARGIN + indent, y: this.y - size, size, font, color })
    }
    lines.forEach((line, i) => {
      if (i > 0) this.ensure(lineH)
      if (line) this.page.drawText(line, { x: MARGIN + indent + bulletW, y: this.y - size, size, font, color })
      this.y -= lineH
    })
  }
  heading(label: string) {
    this.ensure(34)
    this.gap(14)
    this.page.drawText(safeText(label.toUpperCase()), { x: MARGIN, y: this.y - 9, size: 9, font: this.fonts.helvB, color: GREY })
    this.y -= 14
    this.page.drawLine({ start: { x: MARGIN, y: this.y }, end: { x: PAGE_W - MARGIN, y: this.y }, thickness: 0.6, color: LINE })
    this.gap(9)
  }
}

export async function buildGuidePdf(section: GuideSection): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  doc.setTitle(`BC Warehouse Guide — ${section.title}`)
  doc.setAuthor("Vectis Auctions")

  const helv  = await doc.embedFont(StandardFonts.Helvetica)
  const helvB = await doc.embedFont(StandardFonts.HelveticaBold)
  const logo  = await embedVectisLogo(doc)
  const fonts: Fonts = { helv, helvB }

  const w = new Writer(doc, fonts, `BC Warehouse Guide - ${section.title}`)

  // ── Branded banner (first page) ──
  const logoH = 42
  const logoW = logoH * (logo.width / logo.height)
  w.page.drawImage(logo, { x: MARGIN, y: w.y - logoH, width: logoW, height: logoH })
  const printed = new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })
  drawRight(w.page, helv, `Printed ${printed}`, PAGE_W - MARGIN, w.y - 12, 8, LITE)
  drawRight(w.page, helvB, "BC Warehouse Guide", PAGE_W - MARGIN, w.y - 28, 11, GREY)
  w.y -= logoH + 18
  w.page.drawLine({ start: { x: MARGIN, y: w.y }, end: { x: PAGE_W - MARGIN, y: w.y }, thickness: 1.4, color: BLACK })
  w.gap(24)

  // Title + intro
  w.text(section.title, { size: 22, font: helvB, lineGap: 6 })
  w.gap(6)
  w.text(section.intro, { size: 10.5, font: helv, color: GREY, lineGap: 4 })

  // Data source callout
  w.heading("Where the data comes from")
  w.text(section.dataSource, { size: 9.5, font: helv, color: BLUE, lineGap: 3.5 })

  // What you'll see
  w.heading("What you'll see")
  for (const s of section.shows) {
    w.text(s, { size: 9.5, font: helv, lineGap: 3.5, hangingBullet: "•" })
    w.gap(2)
  }

  // Buttons & controls
  w.heading("Buttons & controls")
  for (const c of section.controls) {
    w.text(c.name, { size: 9.5, font: helvB, lineGap: 3.5 })
    w.text(c.what, { size: 9.5, font: helv, color: GREY, indent: 12, lineGap: 3.5 })
    w.gap(5)
  }

  // How to…
  w.heading("How to...")
  for (const h of section.howTo) {
    w.text(h.task, { size: 10, font: helvB, lineGap: 4 })
    h.steps.forEach((step, i) => {
      w.text(step, { size: 9.5, font: helv, indent: 12, lineGap: 3.5, hangingBullet: `${i + 1}.` })
      w.gap(1)
    })
    w.gap(7)
  }

  // Tips
  if (section.tips.length) {
    w.heading("Tips")
    for (const t of section.tips) {
      w.text(t, { size: 9.5, font: helv, lineGap: 3.5, hangingBullet: "•" })
      w.gap(2)
    }
  }

  // Watch out for
  if (section.gotchas.length) {
    w.heading("Watch out for")
    for (const g of section.gotchas) {
      w.text(g, { size: 9.5, font: helv, color: AMBER, lineGap: 3.5, hangingBullet: "!" })
      w.gap(2)
    }
  }

  // Page numbers
  const pages = doc.getPages()
  pages.forEach((p, i) => {
    const label = `Page ${i + 1} of ${pages.length}`
    const lw = helv.widthOfTextAtSize(label, 8)
    p.drawText(label, { x: (PAGE_W - lw) / 2, y: 24, size: 8, font: helv, color: LITE })
  })

  return await doc.save()
}

function drawRight(page: PDFPage, font: PDFFont, text: string, rightX: number, y: number, size: number, color: Color) {
  const safe = safeText(text)
  const width = font.widthOfTextAtSize(safe, size)
  page.drawText(safe, { x: rightX - width, y, size, font, color })
}

// pdf-lib's standard fonts use WinAnsi — replace common Unicode with ASCII
// lookalikes and strip the rest (emoji in control names simply disappear,
// which reads fine: "⟳ Run sync now" → "Run sync now").
function safeText(text: string): string {
  return text
    .replace(/[‘’‚‛]/g, "'")
    .replace(/[“”„‟]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/…/g, "...")
    .replace(/→/g, "->")
    .replace(/±/g, "+/-")
    .replace(/·/g, "-")
    .replace(/[✕✗]/g, "x")
    .replace(/[✓✔]/g, "v")
    .replace(/⚠/g, "!")
    .replace(/⌂/g, "Home")
    .replace(/ /g, " ")
    .replace(/[^\x20-\x7E£€•]/g, "")
    .replace(/ {2,}/g, " ")
    .trim()
}

// Word-wrap to a max width (pdf-lib doesn't wrap). Runs safeText first so
// measurement matches what is drawn.
function wrapText(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const safe = safeText(text)
  if (!safe) return [""]
  const words = safe.split(" ")
  const lines: string[] = []
  let line = ""
  for (const word of words) {
    const trial = line ? `${line} ${word}` : word
    if (font.widthOfTextAtSize(trial, size) <= maxWidth) {
      line = trial
    } else {
      if (line) lines.push(line)
      if (font.widthOfTextAtSize(word, size) > maxWidth) {
        // A single over-long word: hard-chunk it
        let chunk = ""
        for (const ch of word) {
          if (font.widthOfTextAtSize(chunk + ch, size) > maxWidth) { lines.push(chunk); chunk = ch }
          else chunk += ch
        }
        line = chunk
      } else {
        line = word
      }
    }
  }
  if (line) lines.push(line)
  return lines.length ? lines : [""]
}
