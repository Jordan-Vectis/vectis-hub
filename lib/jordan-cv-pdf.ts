// JORDAN.SYS — CV workshop PDFs. A4 portrait, plain and conventional: this is a
// document somebody sends to an employer, so it deliberately does NOT inherit the
// Hub's house styling, and carries no Vectis branding of any kind.
//
// pdf-lib with the standard fonts (RULES.md — never pdfkit, which fails on
// Railway looking for Helvetica.afm; StandardFonts embeds nothing).
import { PDFDocument, PDFPage, StandardFonts, PDFFont, rgb } from "pdf-lib"
import type { Cv } from "@/lib/jordan-cv"

const PAGE_W = 595.28          // A4 portrait
const PAGE_H = 841.89
const MARGIN = 54
const BODY_W = PAGE_W - MARGIN * 2

const INK   = rgb(0.11, 0.12, 0.14)
const MUTED = rgb(0.42, 0.45, 0.5)
const RULE  = rgb(0.80, 0.82, 0.85)

type Ctx = {
  doc:   PDFDocument
  page:  PDFPage
  y:     number
  reg:   PDFFont
  bold:  PDFFont
  ital:  PDFFont
}

/** Split text to fit a width. Words longer than the line (a URL) are hard-broken
 *  rather than left to overflow the margin. */
function wrap(text: string, font: PDFFont, size: number, width: number): string[] {
  const out: string[] = []
  for (const para of (text ?? "").split(/\r?\n/)) {
    if (!para.trim()) { out.push(""); continue }
    let line = ""
    for (const word of para.split(/\s+/)) {
      const next = line ? `${line} ${word}` : word
      if (font.widthOfTextAtSize(next, size) <= width) { line = next; continue }
      if (line) out.push(line)
      if (font.widthOfTextAtSize(word, size) <= width) { line = word; continue }
      // A single word too wide for the line — break it by character.
      let chunk = ""
      for (const ch of word) {
        if (font.widthOfTextAtSize(chunk + ch, size) > width) { out.push(chunk); chunk = ch }
        else chunk += ch
      }
      line = chunk
    }
    if (line) out.push(line)
  }
  return out
}

function newPage(c: Ctx) {
  c.page = c.doc.addPage([PAGE_W, PAGE_H])
  c.y = PAGE_H - MARGIN
}

/** Reserve vertical space, starting a new page if it won't fit. */
function need(c: Ctx, h: number) {
  if (c.y - h < MARGIN) newPage(c)
}

function text(c: Ctx, s: string, opts: { font?: PDFFont; size?: number; colour?: any; gap?: number; x?: number; width?: number } = {}) {
  const font = opts.font ?? c.reg
  const size = opts.size ?? 10
  const lead = size * 1.35
  const x = opts.x ?? MARGIN
  const w = opts.width ?? BODY_W - (x - MARGIN)
  for (const line of wrap(s, font, size, w)) {
    need(c, lead)
    if (line) c.page.drawText(line, { x, y: c.y - size, size, font, color: opts.colour ?? INK })
    c.y -= lead
  }
  if (opts.gap) c.y -= opts.gap
}

function heading(c: Ctx, label: string) {
  need(c, 34)
  c.y -= 8
  c.page.drawText(label.toUpperCase(), { x: MARGIN, y: c.y - 9, size: 9, font: c.bold, color: MUTED })
  c.y -= 13
  c.page.drawLine({ start: { x: MARGIN, y: c.y }, end: { x: PAGE_W - MARGIN, y: c.y }, thickness: 0.6, color: RULE })
  c.y -= 10
}

/** A role's title line, with the dates set right so the eye can scan them. */
function roleLine(c: Ctx, left: string, right: string) {
  const size = 10.5
  need(c, size * 1.4)
  const rightW = right ? c.reg.widthOfTextAtSize(right, 9.5) : 0
  for (const [i, line] of wrap(left, c.bold, size, BODY_W - rightW - 12).entries()) {
    need(c, size * 1.4)
    c.page.drawText(line, { x: MARGIN, y: c.y - size, size, font: c.bold, color: INK })
    if (i === 0 && right) {
      c.page.drawText(right, { x: PAGE_W - MARGIN - rightW, y: c.y - size, size: 9.5, font: c.reg, color: MUTED })
    }
    c.y -= size * 1.4
  }
}

function bullet(c: Ctx, s: string) {
  const size = 10
  const lead = size * 1.35
  const indent = 12
  const lines = wrap(s, c.reg, size, BODY_W - indent)
  for (const [i, line] of lines.entries()) {
    need(c, lead)
    if (i === 0) c.page.drawText("•", { x: MARGIN, y: c.y - size, size, font: c.reg, color: MUTED })
    c.page.drawText(line, { x: MARGIN + indent, y: c.y - size, size, font: c.reg, color: INK })
    c.y -= lead
  }
}

async function start(): Promise<Ctx> {
  const doc  = await PDFDocument.create()
  const reg  = await doc.embedFont(StandardFonts.Helvetica)
  const bold = await doc.embedFont(StandardFonts.HelveticaBold)
  const ital = await doc.embedFont(StandardFonts.HelveticaOblique)
  const page = doc.addPage([PAGE_W, PAGE_H])
  return { doc, page, y: PAGE_H - MARGIN, reg, bold, ital }
}

export async function buildCvPdf(cv: Cv): Promise<Uint8Array> {
  const c = await start()

  if (cv.name) { text(c, cv.name, { font: c.bold, size: 21 }) }
  if (cv.headline) { text(c, cv.headline, { size: 11.5, colour: MUTED }) }
  const contact = [cv.email, cv.phone, cv.location, ...cv.links].filter(Boolean).join("   ·   ")
  if (contact) { c.y -= 2; text(c, contact, { size: 9.5, colour: MUTED }) }

  if (cv.summary) { heading(c, "Profile"); text(c, cv.summary, { size: 10 }) }

  if (cv.experience.length) {
    heading(c, "Experience")
    for (const [i, r] of cv.experience.entries()) {
      if (i > 0) c.y -= 6
      const where = [r.employer, r.location].filter(Boolean).join(", ")
      roleLine(c, [r.title, where].filter(Boolean).join(" — "), [r.start, r.end].filter(Boolean).join(" – "))
      for (const b of r.bullets) bullet(c, b)
    }
  }

  if (cv.education.length) {
    heading(c, "Education")
    for (const e of cv.education) {
      roleLine(c, [e.qualification, e.institution].filter(Boolean).join(" — "), e.year)
      if (e.detail) text(c, e.detail, { size: 9.5, colour: MUTED, x: MARGIN + 12 })
    }
  }

  if (cv.skills.length) { heading(c, "Skills"); text(c, cv.skills.join("   ·   "), { size: 10 }) }

  for (const x of cv.extras) {
    if (!x.heading && !x.lines.length) continue
    heading(c, x.heading || "Other")
    for (const l of x.lines) bullet(c, l)
  }

  return c.doc.save()
}

export async function buildLetterPdf(cv: Cv, letter: string, opts: { company?: string; jobTitle?: string } = {}): Promise<Uint8Array> {
  const c = await start()

  // Sender block, top right — the convention for a covering letter.
  const senderLines = [cv.name, cv.email, cv.phone, cv.location].filter(Boolean)
  for (const line of senderLines) {
    const w = c.reg.widthOfTextAtSize(line, 9.5)
    c.page.drawText(line, { x: PAGE_W - MARGIN - w, y: c.y - 9.5, size: 9.5, font: c.reg, color: MUTED })
    c.y -= 13
  }
  c.y -= 18

  const heading2 = [opts.jobTitle, opts.company].filter(Boolean).join(" — ")
  if (heading2) { text(c, heading2, { font: c.bold, size: 11.5, gap: 8 }) }

  // The letter as written — blank lines between paragraphs are preserved by wrap().
  for (const para of letter.split(/\n\s*\n/)) {
    if (!para.trim()) continue
    text(c, para.trim(), { size: 10.5, gap: 8 })
  }

  return c.doc.save()
}
