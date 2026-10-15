import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib"
import bwipjs from "bwip-js"
import { embedVectisLogo } from "@/lib/pdf-logo"
import { VENDOR_TERMS, VENDOR_TERMS_TITLE } from "./vendor-terms"
import type { CustomerSnapshot } from "./model"

// Goods In printouts. SERVER ONLY. pdf-lib + bwip-js + the shared logo, like every PDF in the Hub
// (never pdfkit). ⚠ The standard fonts are WinAnsi only — every string goes through safe() — and
// drawText doesn't wrap, so wrap() does it.
//
//  • buildReceiptPdf — the receipt as the counter has always printed it (Receipt Totes T0 V.pdf):
//    vendor details and terms, the tote/pallet table, the vendor terms of sale, and a BLANK bank
//    details form. ⚠ The Hub never stores or prints a customer's bank details: the form is for the
//    customer to fill in by hand (2026-10-15 — nothing in the Hub is locked down enough for them).
//  • buildLabelsPdf — one 100 × 50 mm label per tote/pallet (or location), barcode included.

const NAVY = rgb(0.18, 0.196, 0.557)
const INK = rgb(0.1, 0.1, 0.1)
const MUTED = rgb(0.38, 0.38, 0.38)
const LINE = rgb(0.75, 0.75, 0.75)

const COMPANY_LINE = "Fleck Way, Stockton-on-Tees, TS17 9JZ | (+44) 01642 750 616 | Admin@Vectis.co.uk | www.vectis.co.uk"
const COMPANY_REG = "Registered in England and Wales No. 03298762, VAT No. 647566303"

/** WinAnsi-safe text: curly quotes straightened, anything else outside Latin-1 dropped. */
export function safe(s: string | null | undefined): string {
  return String(s ?? "")
    .replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[–—]/g, "-").replace(/…/g, "...")
    .replace(/[^\x20-\x7E\xA0-\xFF\n]/g, "")
}

function wrap(text: string, font: PDFFont, size: number, width: number): string[] {
  const out: string[] = []
  for (const para of safe(text).split("\n")) {
    const words = para.split(/\s+/).filter(Boolean)
    let line = ""
    for (const w of words) {
      const t = line ? `${line} ${w}` : w
      if (font.widthOfTextAtSize(t, size) > width && line) { out.push(line); line = w } else line = t
    }
    out.push(line)
  }
  return out
}

const longDate = (d: Date) => new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", day: "numeric", month: "long", year: "numeric" }).format(d)
const pounds = (n: number) => `£${Number.isInteger(n) ? n : n.toFixed(2)}`

export type ReceiptForPdf = {
  id: string
  createdAt: Date
  customer: CustomerSnapshot
  commission: number
  lottingFee: number
  photographyFee: number
  unsoldFee: number
  reservePercent: number
  ownerConfirmed: boolean
  agentConfirmed: boolean
  createdByName: string | null
  containers: { id: string; kind: string; category: string | null; description: string | null }[]
}

const A4: [number, number] = [595.28, 841.89]
const M = 40

export async function buildReceiptPdf(r: ReceiptForPdf): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  doc.setTitle(`Receipt ${r.id}`)
  doc.setAuthor("Vectis Auctions")
  const font = await doc.embedFont(StandardFonts.Helvetica)
  const bold = await doc.embedFont(StandardFonts.HelveticaBold)
  const logo = await embedVectisLogo(doc)
  const W = A4[0] - 2 * M
  const TOP = A4[1] - M - 70  // below the header
  const BOTTOM = M + 40        // above the footer

  let page!: PDFPage
  let y = 0
  const newPage = () => { page = doc.addPage(A4); y = TOP }
  const need = (h: number) => { if (y - h < BOTTOM) newPage() }
  const text = (s: string, x: number, size: number, f = font, color = INK) => page.drawText(safe(s), { x, y: y - size, size, font: f, color })
  const para = (s: string, size: number, f = font, width = W, x = M, lead = 1.32, color = INK) => {
    for (const line of wrap(s, f, size, width)) { need(size * lead); page.drawText(line, { x, y: y - size, size, font: f, color }); y -= size * lead }
  }

  // ── Page 1: the customer, the terms, the declarations ──
  newPage()
  const c = r.customer
  const address = [c.addressLine1, c.addressLine2, [c.town, c.county].filter(Boolean).join(", "), c.postcode, c.country].filter(s => s && String(s).trim()) as string[]
  const left: [string, string][] = [
    ["Name", [c.salutation, c.name].filter(Boolean).join(" ")],
    ["Address", address.join("\n")],
    ["Email", c.email ?? ""],
    ["Mobile No.", c.mobile ?? ""],
    ["Telephone No.", c.phone ?? ""],
    ["VAT Reg. No.", c.vatRegNo ?? ""],
  ]
  const right: [string, string][] = [
    ["Vendor No.", c.vendorNo ?? ""],
    ["Commission", `${r.commission}%`],
    ["Lotting fee", pounds(r.lottingFee)],
    ["Photography", pounds(r.photographyFee)],
    ["Unsold Fee", pounds(r.unsoldFee)],
  ]
  const colW = W / 2 - 10
  const startY = y
  for (const [label, value] of left) {
    const lines = wrap(value, font, 10, colW - 90)
    text(`${label}:`, M, 10, bold)
    lines.forEach((l, i) => page.drawText(l, { x: M + 90, y: y - 10 - i * 13, size: 10, font, color: INK }))
    y -= Math.max(1, lines.length) * 13 + 4
  }
  const leftEnd = y
  y = startY
  for (const [label, value] of right) {
    text(`${label}:`, M + W / 2 + 10, 10, bold)
    text(value, M + W / 2 + 100, 10)
    y -= 17
  }
  text("VAT applies to all Charges", M + W / 2 + 10, 9, font, MUTED)
  y = Math.min(leftEnd, y - 16) - 14

  const heading = (s: string) => { need(28); y -= 6; text(s, M, 11, bold, NAVY); y -= 17 }
  heading("RESERVE INSTRUCTIONS")
  para(`All items are automatically reserved at ${r.reservePercent}% of bottom estimate (rounded to bidding increment)`, 9.5)
  y -= 6
  heading("UNSOLD LOTS")
  for (const p of [
    "You will be sent the results of each auction by email; this will detail the hammer price or if the lot is unsold. Following this you will be sent a further email with our recommendations for re-entering any unsold lot in a future auction.",
    "In the event of re-offering a lot estimates and reserves will be reduced.",
    "It is the vendor's responsibility to instruct Vectis if they do not wish to re-offer the lot and must make arrangements to collect items within ten working days or storage charges will be incurred.",
    "All instructions must be received via email.",
  ]) { para(p, 9.5); y -= 4 }
  y -= 8

  const tick = (label: string, on: boolean) => {
    const lines = wrap(label, font, 9.5, W - 24)
    need(lines.length * 13 + 4)
    page.drawRectangle({ x: M, y: y - 11, width: 10, height: 10, borderColor: INK, borderWidth: 0.8 })
    if (on) page.drawText("X", { x: M + 2, y: y - 9.5, size: 9, font: bold, color: INK })
    lines.forEach((l, i) => page.drawText(l, { x: M + 18, y: y - 10 - i * 13, size: 9.5, font, color: INK }))
    y -= lines.length * 13 + 6
  }
  tick("I confirm I am the legal owner of the property", r.ownerConfirmed)
  tick("I confirm I am authorised to act as agent on behalf of the legal owner of the property", r.agentConfirmed)
  y -= 4
  para("I authorise you to sell these items as detailed here, I am aware of and agree to the conditions of sale printed here and on Vectis website.", 9.5)
  y -= 34
  need(30)
  page.drawLine({ start: { x: M, y }, end: { x: M + colW, y }, thickness: 0.6, color: INK })
  page.drawLine({ start: { x: M + W / 2 + 10, y }, end: { x: M + W, y }, thickness: 0.6, color: INK })
  y -= 4
  text("Vendor Signature", M, 9, font, MUTED)
  text(`For Vectis${r.createdByName ? `: ${r.createdByName}` : ""}`, M + W / 2 + 10, 9, font, MUTED)

  // ── The totes and pallets ──
  newPage()
  const cols = [{ label: "Tote No.", x: M, w: 80 }, { label: "Type", x: M + 84, w: 50 }, { label: "Category", x: M + 138, w: 110 }, { label: "Description", x: M + 252, w: W - 252 }]
  const tableHead = () => {
    page.drawRectangle({ x: M, y: y - 18, width: W, height: 18, color: NAVY })
    for (const col of cols) page.drawText(col.label, { x: col.x + 4, y: y - 13, size: 9.5, font: bold, color: rgb(1, 1, 1) })
    y -= 22
  }
  tableHead()
  for (const ct of r.containers) {
    const desc = wrap(ct.description ?? "", font, 9.5, cols[3].w - 8)
    const cat = wrap(ct.category ?? "", font, 9.5, cols[2].w - 8)
    const h = Math.max(desc.length, cat.length, 1) * 12 + 6
    if (y - h < BOTTOM) { newPage(); tableHead() }
    page.drawText(safe(ct.id), { x: cols[0].x + 4, y: y - 10, size: 9.5, font: bold, color: INK })
    page.drawText(ct.kind === "pallet" ? "Pallet" : "Tote", { x: cols[1].x + 4, y: y - 10, size: 9.5, font, color: INK })
    cat.forEach((l, i) => page.drawText(l, { x: cols[2].x + 4, y: y - 10 - i * 12, size: 9.5, font, color: INK }))
    desc.forEach((l, i) => page.drawText(l, { x: cols[3].x + 4, y: y - 10 - i * 12, size: 9.5, font, color: INK }))
    y -= h
    page.drawLine({ start: { x: M, y: y + 2 }, end: { x: M + W, y: y + 2 }, thickness: 0.4, color: LINE })
  }
  y -= 10
  para(`${r.containers.length} ${r.containers.length === 1 ? "item" : "items"} booked in on this receipt.`, 9, font, W, M, 1.3, MUTED)

  // ── The vendor terms of sale ──
  newPage()
  para(VENDOR_TERMS_TITLE, 10.5, bold)
  y -= 4
  for (const b of VENDOR_TERMS) {
    if (b.heading) { need(24); y -= 3; para(b.heading, 8, bold) }
    if (b.text) { para(b.text, 7.4, font, W, M, 1.3); y -= 2.5 }
  }

  // ── A BLANK bank details form, to be filled in by hand ──
  newPage()
  para("BANK DETAILS REQUEST FORM", 13, bold, W, M, 1.4, NAVY)
  y -= 6
  para("Please complete your bank details for which you would like to receive your forthcoming seller payment.", 10)
  para("Please ensure you include full IBAN, Swift/BIC Code and Vendor Code if known.", 10)
  y -= 18
  const field = (label: string, value = "") => {
    need(34)
    text(label, M, 10, bold)
    if (value) text(value, M + 150, 10)
    page.drawLine({ start: { x: M + 150, y: y - 14 }, end: { x: M + W, y: y - 14 }, thickness: 0.5, color: LINE })
    y -= 32
  }
  field("Vendor No.:", c.vendorNo ?? "")
  field("Account/Company Name:", [c.salutation, c.name].filter(Boolean).join(" "))
  field("Name on bank account:")
  field("Sort Code:")
  field("Account Number:")
  field("IBAN:")
  field("BIC/ Swift:")
  y -= 6
  para("These bank details will be kept on file and used for all future seller payments. If at any stage, the details are subject to change, please notify us immediately. We will require a new Bank Details form to be completed and submitted.", 9.5)
  y -= 4
  para("If you require any further assistance or clarification, please do not hesitate to contact a member of the team.", 9.5)

  // ── The header and footer on every page ──
  const pages = doc.getPages()
  const logoH = 46
  const logoW = (logo.width / logo.height) * logoH
  pages.forEach((p, i) => {
    p.drawImage(logo, { x: M, y: A4[1] - M - logoH, width: logoW, height: logoH })
    const title = "RECEIPT - Confirmation"
    p.drawText(title, { x: A4[0] - M - bold.widthOfTextAtSize(title, 14), y: A4[1] - M - 16, size: 14, font: bold, color: INK })
    const ref = `NO.: ${r.id}    ${longDate(r.createdAt)}`
    p.drawText(safe(ref), { x: A4[0] - M - font.widthOfTextAtSize(safe(ref), 10), y: A4[1] - M - 34, size: 10, font, color: INK })
    p.drawLine({ start: { x: M, y: A4[1] - M - 58 }, end: { x: A4[0] - M, y: A4[1] - M - 58 }, thickness: 0.8, color: NAVY })
    p.drawLine({ start: { x: M, y: M + 30 }, end: { x: A4[0] - M, y: M + 30 }, thickness: 0.5, color: LINE })
    const foot = (s: string, yy: number, size: number) => p.drawText(s, { x: (A4[0] - font.widthOfTextAtSize(s, size)) / 2, y: yy, size, font, color: MUTED })
    foot(COMPANY_LINE, M + 18, 7.5)
    foot(COMPANY_REG, M + 8, 7.5)
    const pn = `Page ${i + 1} of ${pages.length}`
    p.drawText(pn, { x: A4[0] - M - font.widthOfTextAtSize(pn, 7.5), y: M - 4, size: 7.5, font, color: MUTED })
  })

  return doc.save()
}

// ─── Labels ─────────────────────────────────────────────────────────────────────────────────

export type LabelForPdf = {
  /** What the barcode encodes and the big number printed: a tote, pallet or location code. */
  code: string
  /** Small line above the number ("TOTE", "PALLET", "BENCH"…). */
  kicker: string
  /** Up to three short lines under the barcode. */
  lines: string[]
}

const MM = 72 / 25.4

/** One label per page, 100 × 50 mm by default — the common thermal label; any label printer prints a PDF page. */
export async function buildLabelsPdf(labels: LabelForPdf[], size: { widthMm: number; heightMm: number } = { widthMm: 100, heightMm: 50 }): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  doc.setTitle(labels.length === 1 ? `Label ${labels[0].code}` : `${labels.length} labels`)
  const font = await doc.embedFont(StandardFonts.Helvetica)
  const bold = await doc.embedFont(StandardFonts.HelveticaBold)
  const PW = size.widthMm * MM, PH = size.heightMm * MM, pad = 3.5 * MM

  for (const l of labels) {
    const p = doc.addPage([PW, PH])
    const code = safe(l.code)
    p.drawText(safe(l.kicker).toUpperCase(), { x: pad, y: PH - pad - 7, size: 7, font: bold, color: MUTED })
    // The number big enough to read across the warehouse, shrunk only if it would not fit.
    let numSize = 22
    while (bold.widthOfTextAtSize(code, numSize) > PW * 0.55 && numSize > 12) numSize -= 1
    p.drawText(code, { x: pad, y: PH - pad - 7 - 4 - numSize * 0.8, size: numSize, font: bold, color: INK })

    // A white margin (quiet zone) either side of the bars — scanners need it to find where the code starts.
    const png = await bwipjs.toBuffer({ bcid: "code128", text: code, scale: 4, height: 12, includetext: false, backgroundcolor: "FFFFFF", paddingwidth: 10, paddingheight: 2 })
    const img = await doc.embedPng(png)
    const bw = PW * 0.4, bh = Math.min(PH * 0.42, (img.height / img.width) * bw * 2.2)
    p.drawImage(img, { x: PW - pad - bw, y: PH - pad - bh, width: bw, height: bh })

    let yy = pad + 2 + (Math.min(l.lines.length, 3) - 1) * 10
    for (const line of l.lines.slice(0, 3)) {
      let t = safe(line)
      while (font.widthOfTextAtSize(t, 8.5) > PW - 2 * pad && t.length > 4) t = t.slice(0, -2)
      if (t !== safe(line)) t = t.replace(/.{0,1}$/, "...")
      p.drawText(t, { x: pad, y: yy, size: 8.5, font, color: INK })
      yy -= 10
    }
  }
  return doc.save()
}
