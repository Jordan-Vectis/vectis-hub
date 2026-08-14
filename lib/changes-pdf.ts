// PDF for a Patches & Changes progress report — the thing that gets printed or
// emailed to a manager.
//
// A4 PORTRAIT with the Vectis header, matching the marketing plan rather than
// the landscape cataloguing reports: this is a document to read, not a table.
// Server-side pdf-lib throughout (RULES: never pdfkit).
//
// The report body is the plain text the AI wrote and the user edited. Two shapes
// are recognised so it prints with structure instead of as a wall of prose:
// a line in ALL CAPS is an area heading, and a line starting "- " is a bullet.

import { PDFDocument, PDFPage, PDFFont, StandardFonts, rgb } from "pdf-lib"
import { embedVectisLogo } from "@/lib/pdf-logo"

const PAGE_W = 595.28
const PAGE_H = 841.89
const MARGIN = 48
const CONTENT_W = PAGE_W - MARGIN * 2
const RIGHT = PAGE_W - MARGIN

const INK  = rgb(0, 0, 0)
const GREY = rgb(0.30, 0.30, 0.30)
const MUTE = rgb(0.50, 0.50, 0.50)
const RULE = rgb(0.80, 0.80, 0.80)
const ACCENT = rgb(0.29, 0.33, 0.83)   // the page's indigo

const UK_TZ = "Europe/London"

export type ChangesReport = {
  title: string
  body: string
  periodFrom: Date
  periodTo: Date
  changeCount: number
  createdBy?: string | null
}

// pdf-lib's StandardFonts are WinAnsi only — strip what they can't draw.
function safeAscii(text: string): string {
  return (text ?? "")
    .replace(/[‘’‚‛]/g, "'")
    .replace(/[“”„‟]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/…/g, "...")
    .replace(/ /g, " ")
    .replace(/[^\x20-\x7E£€]/g, "")
    .trimEnd()
}

/** ⚠ Split on newlines BEFORE sanitising — a newline is outside the allowed
 *  range and would be DELETED, gluing the last word of one line onto the next. */
function wrap(text: string, font: PDFFont, size: number, maxW: number): string[] {
  const out: string[] = []
  for (const para of (text ?? "").split("\n").map(safeAscii)) {
    if (!para.trim()) { out.push(""); continue }
    let line = ""
    for (const word of para.split(/\s+/).filter(Boolean)) {
      const next = line ? `${line} ${word}` : word
      if (font.widthOfTextAtSize(next, size) <= maxW) { line = next; continue }
      if (line) out.push(line)
      line = word
    }
    if (line) out.push(line)
  }
  return out
}

function truncate(text: string, font: PDFFont, size: number, maxW: number): string {
  let s = safeAscii(text)
  if (font.widthOfTextAtSize(s, size) <= maxW) return s
  while (s.length > 1 && font.widthOfTextAtSize(s + "...", size) > maxW) s = s.slice(0, -1)
  return s + "..."
}

/** A heading line: mostly capitals, short, and not a bullet. */
function isHeading(line: string): boolean {
  const s = line.trim()
  if (!s || s.length > 60 || s.startsWith("-")) return false
  const letters = s.replace(/[^A-Za-z]/g, "")
  if (letters.length < 3) return false
  return letters === letters.toUpperCase()
}

export async function buildChangesReportPdf(report: ChangesReport, now: Date = new Date()): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  doc.setTitle(report.title)
  doc.setAuthor("Vectis Auctions")

  const helv  = await doc.embedFont(StandardFonts.Helvetica)
  const helvB = await doc.embedFont(StandardFonts.HelveticaBold)
  const logo  = await embedVectisLogo(doc)

  const fmtDate = (d: Date) => d.toLocaleDateString("en-GB", { timeZone: UK_TZ, day: "numeric", month: "long", year: "numeric" })
  const printed = now.toLocaleString("en-GB", { timeZone: UK_TZ, day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" })

  let page: PDFPage = doc.addPage([PAGE_W, PAGE_H])
  let y = 0

  const header = () => {
    const logoH = 26
    const logoW = logoH * (logo.width / logo.height)
    page.drawImage(logo, { x: MARGIN, y: PAGE_H - MARGIN - logoH, width: logoW, height: logoH })
    page.drawText("Vectis Hub - progress report", { x: MARGIN, y: PAGE_H - MARGIN - logoH - 12, size: 9, font: helvB, color: MUTE })
    page.drawText(truncate(report.title, helvB, 15, CONTENT_W), { x: MARGIN, y: PAGE_H - MARGIN - logoH - 31, size: 15, font: helvB, color: INK })
    y = PAGE_H - MARGIN - logoH - 41
    page.drawLine({ start: { x: MARGIN, y }, end: { x: RIGHT, y }, thickness: 1.2, color: INK })
    y -= 18
  }
  const newPage = () => { page = doc.addPage([PAGE_W, PAGE_H]); header() }
  const ensure = (space: number) => { if (y - space < MARGIN + 24) newPage() }

  header()

  // Provenance — the period and how many changes it covers.
  const meta = `${fmtDate(report.periodFrom)} to ${fmtDate(report.periodTo)}  ·  ${report.changeCount} change${report.changeCount === 1 ? "" : "s"}`
  page.drawText(safeAscii(meta), { x: MARGIN, y: y - 8, size: 9, font: helvB, color: ACCENT })
  y -= 22

  for (const raw of report.body.split("\n")) {
    const line = raw.trimEnd()

    if (!line.trim()) { y -= 7; continue }

    if (isHeading(line)) {
      ensure(34)
      y -= 8
      page.drawText(truncate(line.trim(), helvB, 10.5, CONTENT_W), { x: MARGIN, y: y - 10, size: 10.5, font: helvB, color: ACCENT })
      y -= 15
      page.drawLine({ start: { x: MARGIN, y }, end: { x: RIGHT, y }, thickness: 0.5, color: RULE })
      y -= 9
      continue
    }

    const bullet = /^[-*•]\s+/.test(line.trim())
    const text   = bullet ? line.trim().replace(/^[-*•]\s+/, "") : line.trim()
    const indent = bullet ? 14 : 0
    const size   = 9.5
    const lead   = 13.5

    const lines = wrap(text, helv, size, CONTENT_W - indent)
    lines.forEach((l, i) => {
      ensure(lead)
      if (bullet && i === 0) {
        page.drawCircle({ x: MARGIN + 4, y: y - 6, size: 1.6, color: GREY })
      }
      page.drawText(l, { x: MARGIN + indent, y: y - 9, size, font: helv, color: INK })
      y -= lead
    })
    y -= 2
  }

  // Footer on every page — who it came from and when it was printed.
  const label = `Vectis Hub progress report${report.createdBy ? ` - ${report.createdBy}` : ""}  ·  printed ${printed}`
  const pages = doc.getPages()
  pages.forEach((pg, i) => {
    pg.drawText(truncate(label, helv, 7, CONTENT_W - 60), { x: MARGIN, y: MARGIN - 22, size: 7, font: helv, color: MUTE })
    const n = `Page ${i + 1} of ${pages.length}`
    pg.drawText(n, { x: RIGHT - helv.widthOfTextAtSize(n, 7), y: MARGIN - 22, size: 7, font: helv, color: MUTE })
  })

  return doc.save()
}
