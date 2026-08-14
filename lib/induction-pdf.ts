// PDF of one signed induction form — the copy that goes in the personnel file.
//
// A4 PORTRAIT with the Vectis header, pdf-lib throughout (RULES: never pdfkit).
//
// ⚠ It prints the SNAPSHOT stored on the signature row, never the current form. The form is
// editable, so printing today's wording under a signature given months ago would misrepresent
// what the person actually agreed to.

import { PDFDocument, PDFPage, PDFFont, StandardFonts, rgb } from "pdf-lib"
import { embedVectisLogo } from "@/lib/pdf-logo"
import { parseSignedItems } from "@/lib/induction"

const PAGE_W = 595.28
const PAGE_H = 841.89
const MARGIN = 48
const CONTENT_W = PAGE_W - MARGIN * 2
const RIGHT = PAGE_W - MARGIN

const INK    = rgb(0, 0, 0)
const GREY   = rgb(0.30, 0.30, 0.30)
const MUTE   = rgb(0.50, 0.50, 0.50)
const RULE   = rgb(0.80, 0.80, 0.80)
const ACCENT = rgb(0.85, 0.47, 0.05)   // the tool's amber
const RED    = rgb(0.75, 0.15, 0.15)

const UK_TZ = "Europe/London"

export type SignatureRecord = {
  /** Printed in the footer so a paper copy in a personnel file can be traced back to its row. */
  id: string
  formTitle: string
  bodySnapshot: string | null
  declarationSnapshot: string | null
  items: unknown
  personName: string
  company: string | null
  jobTitle: string | null
  startDate: string | null
  notes: string | null
  signature: string
  takenByName: string | null
  signedAt: Date
}

// pdf-lib's StandardFonts are WinAnsi — strip only what they genuinely can't draw.
//
// ⚠ WinAnsi (cp1252) DOES encode the accented Latin range, so keeping it is not optional
// politeness: this document names a specific person, and "José Fernández" printed as
// "Jos Fernndez" is a personnel record with the wrong name on it. Characters outside cp1252
// (ł, ș, ż) still cannot be drawn by a standard font and are dropped — an embedded TTF would
// be needed for those.
function safeAscii(text: string): string {
  return (text ?? "")
    .replace(/[‘’‚‛]/g, "'")
    .replace(/[“”„‟]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/…/g, "...")
    .replace(/ /g, " ")
    .replace(/[^\x20-\x7E\xA0-\xFF£€]/g, "")
    .trimEnd()
}

/** ⚠ Split on newlines BEFORE sanitising — a newline is outside the allowed range and would be
 *  DELETED, gluing the last word of one line onto the next. */
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

export async function buildInductionSignaturePdf(rec: SignatureRecord, now: Date = new Date()): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  doc.setTitle(`${rec.formTitle} - ${rec.personName}`)
  doc.setAuthor("Vectis Auctions")

  const helv  = await doc.embedFont(StandardFonts.Helvetica)
  const helvB = await doc.embedFont(StandardFonts.HelveticaBold)
  const logo  = await embedVectisLogo(doc)

  const stamp = (d: Date) => d.toLocaleString("en-GB", { timeZone: UK_TZ, day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" })

  let page: PDFPage = doc.addPage([PAGE_W, PAGE_H])
  let y = 0

  const header = () => {
    const logoH = 26
    const logoW = logoH * (logo.width / logo.height)
    page.drawImage(logo, { x: MARGIN, y: PAGE_H - MARGIN - logoH, width: logoW, height: logoH })
    page.drawText("Signed record", { x: MARGIN, y: PAGE_H - MARGIN - logoH - 12, size: 9, font: helvB, color: MUTE })
    page.drawText(truncate(rec.formTitle, helvB, 15, CONTENT_W), { x: MARGIN, y: PAGE_H - MARGIN - logoH - 31, size: 15, font: helvB, color: INK })
    y = PAGE_H - MARGIN - logoH - 41
    page.drawLine({ start: { x: MARGIN, y }, end: { x: RIGHT, y }, thickness: 1.2, color: INK })
    y -= 18
  }
  const newPage = () => { page = doc.addPage([PAGE_W, PAGE_H]); header() }
  const ensure  = (space: number) => { if (y - space < MARGIN + 24) newPage() }

  const heading = (text: string) => {
    ensure(34)
    y -= 6
    page.drawText(safeAscii(text), { x: MARGIN, y: y - 10, size: 10.5, font: helvB, color: ACCENT })
    y -= 15
    page.drawLine({ start: { x: MARGIN, y }, end: { x: RIGHT, y }, thickness: 0.5, color: RULE })
    y -= 10
  }

  const body = (text: string, size = 9.5, indent = 0, color = INK) => {
    for (const line of wrap(text, helv, size, CONTENT_W - indent)) {
      ensure(13.5)
      if (line) page.drawText(line, { x: MARGIN + indent, y: y - 9, size, font: helv, color })
      y -= 13.5
    }
  }

  header()

  // Who signed it
  heading("WHO SIGNED")
  const facts: [string, string][] = [
    ["Name", rec.personName],
    ...(rec.company   ? [["Company", rec.company] as [string, string]]     : []),
    ...(rec.jobTitle  ? [["Job title", rec.jobTitle] as [string, string]]  : []),
    ...(rec.startDate ? [["Start date", rec.startDate] as [string, string]] : []),
    ["Signed", stamp(rec.signedAt)],
    ["Taken by", rec.takenByName ?? "-"],
  ]
  for (const [k, v] of facts) {
    ensure(14)
    page.drawText(safeAscii(k), { x: MARGIN, y: y - 9, size: 9.5, font: helvB, color: GREY })
    page.drawText(truncate(v, helv, 9.5, CONTENT_W - 90), { x: MARGIN + 90, y: y - 9, size: 9.5, font: helv, color: INK })
    y -= 14
  }

  // What they confirmed
  const items = parseSignedItems(rec.items)
  if (items.length) {
    heading("WHAT THEY CONFIRMED")
    // ⚠ A REQUIRED point cannot be saved unticked — signInductionForm refuses. So an unticked
    // line is an optional point left blank, and printing every one of them in red under "were
    // NOT confirmed" flagged perfectly good records as defective. Only a required line that is
    // somehow unticked (an old row, or a form edited afterwards) is a genuine finding.
    const wrongly = items.filter(it => !it.ticked && it.required === true)
    for (const it of items) {
      const bad   = !it.ticked && it.required === true
      const mark  = it.ticked ? "[X]" : "[ ]"
      const color = bad ? RED : it.ticked ? INK : GREY
      const label = it.ticked ? it.label : `${it.label}  (optional - not ticked)`
      const lines = wrap(label, helv, 9.5, CONTENT_W - 22)
      lines.forEach((l, i) => {
        ensure(13.5)
        if (i === 0) page.drawText(mark, { x: MARGIN, y: y - 9, size: 9.5, font: helvB, color })
        page.drawText(l, { x: MARGIN + 22, y: y - 9, size: 9.5, font: helv, color })
        y -= 13.5
      })
      if (it.detail) {
        for (const l of wrap(it.detail, helv, 8.5, CONTENT_W - 34)) {
          ensure(12)
          page.drawText(l, { x: MARGIN + 34, y: y - 8, size: 8.5, font: helv, color: GREY })
          y -= 12
        }
      }
      y -= 2
    }
    if (wrongly.length) {
      ensure(16)
      page.drawText("Lines marked [ ] above were REQUIRED and were not confirmed.", { x: MARGIN, y: y - 9, size: 8.5, font: helvB, color: RED })
      y -= 16
    }
  }

  if (rec.notes) {
    heading("WHAT THEY ASKED")
    body(rec.notes)
  }

  // The wording that was on the screen
  if (rec.bodySnapshot) {
    heading("THE FORM AS IT WAS SIGNED")
    body(rec.bodySnapshot, 8.5, 0, GREY)
  }

  if (rec.declarationSnapshot) {
    heading("DECLARATION")
    body(rec.declarationSnapshot)
  }

  // The signature itself
  heading("SIGNATURE")
  const base64 = rec.signature.startsWith("data:image/png;base64,")
    ? rec.signature.slice("data:image/png;base64,".length)
    : ""
  if (base64) {
    try {
      const png = await doc.embedPng(Buffer.from(base64, "base64"))
      const w = Math.min(260, CONTENT_W)
      const h = w * (png.height / png.width)
      ensure(h + 26)
      page.drawImage(png, { x: MARGIN, y: y - h, width: w, height: h })
      y -= h + 6
      page.drawLine({ start: { x: MARGIN, y }, end: { x: MARGIN + w, y }, thickness: 0.8, color: INK })
      y -= 12
      page.drawText(safeAscii(`${rec.personName}  -  ${stamp(rec.signedAt)}`), { x: MARGIN, y: y - 8, size: 8.5, font: helv, color: GREY })
      y -= 16
    } catch {
      // A signature that will not decode must SAY so — a silently blank space under
      // "Signature" would read as an unsigned form.
      body("The stored signature image could not be rendered. The record itself is intact — see the Hub.", 9, 0, RED)
    }
  } else {
    body("No signature image is stored against this record.", 9, 0, RED)
  }

  const label = `Vectis Hub induction record ${rec.id}  -  printed ${stamp(now)}`
  const pages = doc.getPages()
  pages.forEach((pg, i) => {
    pg.drawText(truncate(label, helv, 7, CONTENT_W - 60), { x: MARGIN, y: MARGIN - 22, size: 7, font: helv, color: MUTE })
    const n = `Page ${i + 1} of ${pages.length}`
    pg.drawText(n, { x: RIGHT - helv.widthOfTextAtSize(n, 7), y: MARGIN - 22, size: 7, font: helv, color: MUTE })
  })

  return doc.save()
}
