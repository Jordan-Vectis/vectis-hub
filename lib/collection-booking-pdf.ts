import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFImage, type PDFPage } from "pdf-lib"
import { embedVectisLogo } from "@/lib/pdf-logo"
import { safe } from "@/lib/goods-in/pdf"

// Admin & Operations → Collection bookings: one booking as a printable A4 sheet, with the Vectis
// header and footer like the Goods In receipt — everything on the booking (vendor, where and when, what
// and how much, special requirements, drivers and van, every hotel stay, nearby collections, the notes)
// and the photos of the collection on the pages after. SERVER ONLY. pdf-lib (never pdfkit); the
// standard fonts are WinAnsi only, so every string goes through safe(), and wrap() does the wrapping.

const NAVY = rgb(0.18, 0.196, 0.557)
const INK = rgb(0.1, 0.1, 0.1)
const MUTED = rgb(0.38, 0.38, 0.38)
const LINE = rgb(0.75, 0.75, 0.75)
const TINT = rgb(0.95, 0.96, 0.99)
const AMBER_TINT = rgb(1, 0.97, 0.88)
const AMBER = rgb(0.72, 0.45, 0.05)

const COMPANY_LINE = "Fleck Way, Stockton-on-Tees, TS17 9JZ | (+44) 01642 750 616 | Admin@Vectis.co.uk | www.vectis.co.uk"
const COMPANY_REG = "Registered in England and Wales No. 03298762, VAT No. 647566303"

const A4: [number, number] = [595.28, 841.89]
const M = 40

export type CollectionPdfHotel = {
  name: string; address: string; phone: string; checkIn: Date | null; checkOut: Date | null
  rooms: string; guests: string; confirmationNo: string; bookedVia: string; costPence: number | null
  payment: string; notes: string; files: number
}
export type CollectionPdfInput = {
  ref: string
  statusLabel: string
  ownerName: string | null
  vendorName: string; vendorNo: string; phone: string; email: string
  address: string; postcode: string; area: string | null
  collectFrom: Date | null; collectTo: Date | null; timeWindow: string
  description: string; size: string; requirements: string
  drivers: string[]; van: string; needsHotel: boolean
  hotels: CollectionPdfHotel[]
  nearby: { miles: number; ref: string; vendorName: string; place: string; date: Date | null; status: string }[]
  nearbyMiles: number
  notes: { at: Date; byName: string; text: string }[]
  /** Photos already turned into JPEGs; `pdfs` = PDF files on the booking that can't be drawn here. */
  photos: Buffer[]
  photosMissing: number
  pdfs: number
  printedBy: string
}

function wrap(text: string, font: PDFFont, size: number, width: number): string[] {
  const out: string[] = []
  const fits = (t: string) => font.widthOfTextAtSize(t, size) <= width
  for (const para of safe(text).split("\n")) {
    const words = para.split(/\s+/).filter(Boolean)
    let line = ""
    for (let w of words) {
      const t = line ? `${line} ${w}` : w
      if (fits(t)) { line = t; continue }
      if (line) { out.push(line); line = "" }
      while (!fits(w) && w.length > 1) {
        let n = w.length - 1
        while (n > 1 && !fits(w.slice(0, n))) n--
        out.push(w.slice(0, n))
        w = w.slice(n)
      }
      line = w
    }
    out.push(line)
  }
  return out
}

/** Collection and hotel dates are stored as midnight UTC of the day, so they're read in UTC. */
const fullDay = (d: Date | null) => d ? new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(d) : ""
const shortDay = (d: Date | null) => d ? new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", weekday: "short", day: "numeric", month: "short" }).format(d) : "no date"
const stamp = (d: Date) => new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(d)
const money = (p: number | null) => (p == null ? "" : `£${(p / 100).toFixed(2)}`)
const nightsOf = (a: Date | null, b: Date | null) => (a && b ? Math.round((b.getTime() - a.getTime()) / 86_400_000) : null)

export async function buildCollectionBookingPdf(b: CollectionPdfInput): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  doc.setTitle(`Collection ${b.ref}${b.vendorName ? ` - ${safe(b.vendorName)}` : ""}`)
  doc.setAuthor("Vectis Auctions")
  const font = await doc.embedFont(StandardFonts.Helvetica)
  const bold = await doc.embedFont(StandardFonts.HelveticaBold)
  const logo = await embedVectisLogo(doc)
  const W = A4[0] - 2 * M
  const TOP = A4[1] - M - 72
  const BOTTOM = M + 40
  const LABEL_W = 118

  let page!: PDFPage
  let y = 0
  const newPage = () => { page = doc.addPage(A4); y = TOP }
  const need = (h: number) => { if (y - h < BOTTOM) newPage() }

  const heading = (t: string) => {
    need(40)
    y -= 8
    page.drawText(safe(t).toUpperCase(), { x: M, y: y - 11, size: 11, font: bold, color: NAVY })
    y -= 15
    page.drawLine({ start: { x: M, y }, end: { x: M + W, y }, thickness: 0.6, color: NAVY })
    y -= 7
  }
  /** A bold label on the left and its value wrapped beside it. Blank values are skipped. */
  const row = (label: string, value: string, opts: { size?: number; valueFont?: PDFFont; color?: typeof INK } = {}) => {
    const v = (value ?? "").trim()
    if (!v) return
    const size = opts.size ?? 10
    const lines = wrap(v, opts.valueFont ?? font, size, W - LABEL_W)
    const lead = size * 1.35
    need(Math.min(lines.length, 3) * lead + 2)
    page.drawText(safe(label), { x: M, y: y - size, size: size - 0.5, font: bold, color: MUTED })
    for (const l of lines) {
      need(lead)
      page.drawText(l, { x: M + LABEL_W, y: y - size, size, font: opts.valueFont ?? font, color: opts.color ?? INK })
      y -= lead
    }
    y -= 2
  }
  const para = (text: string, size = 10, f: PDFFont = font, color = INK, x = M, width = W) => {
    for (const l of wrap(text, f, size, width)) {
      need(size * 1.35)
      page.drawText(l, { x, y: y - size, size, font: f, color })
      y -= size * 1.35
    }
  }
  /** Text in a tinted, bordered box — for the things a driver mustn't miss. */
  const boxed = (title: string, text: string, fill = TINT, titleColor = NAVY) => {
    const size = 10.5
    const lines = wrap(text, font, size, W - 20)
    const h = 22 + lines.length * size * 1.35 + 8
    need(Math.min(h, 200))
    if (y - h >= BOTTOM) {
      page.drawRectangle({ x: M, y: y - h, width: W, height: h, color: fill, borderColor: LINE, borderWidth: 0.6 })
      page.drawText(safe(title), { x: M + 10, y: y - 16, size: 10, font: bold, color: titleColor })
      let yy = y - 22
      for (const l of lines) { page.drawText(l, { x: M + 10, y: yy - size, size, font, color: INK }); yy -= size * 1.35 }
      y -= h + 6
    } else {
      // Too long for one box on this page: plain text that can run on over the page.
      page.drawText(safe(title), { x: M, y: y - 10, size: 10, font: bold, color: titleColor }); y -= 16
      para(text, size)
      y -= 6
    }
  }

  newPage()

  // ── The essentials, in a box at the top ──
  const when = b.collectFrom
    ? (b.collectTo && b.collectTo.getTime() !== b.collectFrom.getTime() ? `${fullDay(b.collectFrom)} to ${fullDay(b.collectTo)}` : fullDay(b.collectFrom))
    : "Not set yet"
  const where = [b.address.replace(/\s*\r?\n\s*/g, ", "), b.postcode].filter(Boolean).join(", ")
  {
    const size = 12
    const whereLines = wrap(where || "No address yet", bold, size, W - 20 - 70)
    const h = 18 + (2 + whereLines.length) * 17
    page.drawRectangle({ x: M, y: y - h, width: W, height: h, color: TINT, borderColor: NAVY, borderWidth: 0.8 })
    let yy = y - 20
    const line = (label: string, value: string, f = bold) => {
      page.drawText(label, { x: M + 10, y: yy, size: 9, font: bold, color: MUTED })
      page.drawText(safe(value), { x: M + 80, y: yy, size, font: f, color: INK })
      yy -= 17
    }
    line("WHEN", `${when}${b.timeWindow ? `, ${b.timeWindow}` : ""}`)
    page.drawText("WHERE", { x: M + 10, y: yy, size: 9, font: bold, color: MUTED })
    for (const l of whereLines) { page.drawText(l, { x: M + 80, y: yy, size, font: bold, color: INK }); yy -= 17 }
    line("STATUS", `${b.statusLabel}${b.ownerName ? `  (dealt with by ${b.ownerName})` : ""}`, font)
    y -= h + 8
  }

  if (b.requirements.trim()) boxed("SPECIAL REQUIREMENTS", b.requirements, AMBER_TINT, AMBER)

  heading("Vendor")
  row("Name", b.vendorName)
  row("Vendor no.", b.vendorNo)
  row("Phone", b.phone || "Not given", { valueFont: bold, color: b.phone ? INK : AMBER })
  row("Email", b.email)
  row("Address", [b.address, b.postcode].filter(Boolean).join("\n"))
  row("Area", b.area ?? "")

  heading("The collection")
  row("What's being collected", b.description || "Not described yet")
  row("How much", b.size)

  heading("Driver and van")
  row("Drivers", b.drivers.join(", ") || "Not assigned yet", { valueFont: bold })
  row("Van", b.van || "Not assigned yet")

  heading(b.hotels.length > 1 ? `Hotel stays (${b.hotels.length})` : "Hotel")
  if (!b.hotels.length) {
    para(b.needsHotel ? "A hotel is needed - none booked yet." : "No hotel - it's a day trip.", 10, font, b.needsHotel ? AMBER : MUTED)
  }
  b.hotels.forEach((h, i) => {
    if (i > 0) { y -= 4; need(20); page.drawLine({ start: { x: M, y }, end: { x: M + W, y }, thickness: 0.4, color: LINE }); y -= 8 }
    const n = nightsOf(h.checkIn, h.checkOut)
    row("Hotel", h.name || "Not named", { valueFont: bold })
    row("Address", h.address)
    row("Phone", h.phone)
    row("Check-in", fullDay(h.checkIn) || "Not set")
    row("Check-out", `${fullDay(h.checkOut) || "Not set"}${n != null && n > 0 ? `  (${n} night${n === 1 ? "" : "s"})` : ""}`)
    row("Rooms", h.rooms)
    row("Who's staying", h.guests)
    row("Confirmation no.", h.confirmationNo || "Not confirmed yet", { valueFont: bold, color: h.confirmationNo ? INK : AMBER })
    row("Booked through", h.bookedVia)
    row("Cost", money(h.costPence))
    row("Payment", h.payment)
    row("Notes", h.notes)
    if (h.files) row("Confirmation file", `${h.files} on the Hub`)
  })

  if (b.nearby.length) {
    heading(`Nearby collections (within ${b.nearbyMiles} miles)`)
    para("Straight-line miles between postcodes - by road is usually a bit further.", 8.5, font, MUTED)
    y -= 2
    for (const n of b.nearby) {
      const text = `${n.ref}  ${n.vendorName || "No vendor name"}  -  ${n.place || "no postcode"}  -  ${shortDay(n.date)}  -  ${n.status}`
      need(14)
      const miles = n.miles < 1 ? "under 1 mi" : `${Math.round(n.miles)} mi`
      page.drawText(miles, { x: M, y: y - 10, size: 10, font: bold, color: NAVY })
      const lines = wrap(text, font, 10, W - 70)
      for (const l of lines) { need(13.5); page.drawText(l, { x: M + 70, y: y - 10, size: 10, font, color: INK }); y -= 13.5 }
    }
  }

  if (b.notes.length) {
    heading("Notes")
    for (const n of b.notes) {
      need(30)
      page.drawText(safe(`${stamp(n.at)} - ${n.byName || "-"}`), { x: M, y: y - 8.5, size: 8.5, font: bold, color: MUTED })
      y -= 12
      para(n.text, 10)
      y -= 4
    }
  }

  // ── The photos, on their own pages: two across, as large as fits ──
  if (b.photos.length || b.photosMissing || b.pdfs) {
    newPage()
    page.drawText("PHOTOS OF THE COLLECTION", { x: M, y: y - 11, size: 11, font: bold, color: NAVY })
    y -= 15
    page.drawLine({ start: { x: M, y }, end: { x: M + W, y }, thickness: 0.6, color: NAVY })
    y -= 10
    const extra = [
      b.photosMissing ? `${b.photosMissing} photo${b.photosMissing === 1 ? "" : "s"} couldn't be added` : "",
      b.pdfs ? `${b.pdfs} PDF file${b.pdfs === 1 ? " is" : "s are"} on the booking in the Hub` : "",
    ].filter(Boolean).join(" - ")
    if (extra) { para(extra, 9, font, MUTED); y -= 4 }
    const gap = 12
    const cellW = (W - gap) / 2
    const cellH = 230
    let col = 0
    for (const buf of b.photos) {
      let img: PDFImage
      try { img = await doc.embedJpg(buf) } catch { continue }
      if (col === 0) need(cellH + gap)
      const scale = Math.min(cellW / img.width, cellH / img.height)
      const w = img.width * scale, h = img.height * scale
      const x = M + col * (cellW + gap) + (cellW - w) / 2
      page.drawRectangle({ x: M + col * (cellW + gap), y: y - cellH, width: cellW, height: cellH, borderColor: LINE, borderWidth: 0.5 })
      page.drawImage(img, { x, y: y - cellH + (cellH - h) / 2, width: w, height: h })
      col++
      if (col === 2) { col = 0; y -= cellH + gap }
    }
  }

  // ── The header and footer on every page ──
  const pages = doc.getPages()
  const logoH = 46
  const logoW = (logo.width / logo.height) * logoH
  const printed = `Printed ${stamp(new Date())} by ${b.printedBy}`
  pages.forEach((p, i) => {
    p.drawImage(logo, { x: M, y: A4[1] - M - logoH, width: logoW, height: logoH })
    const title = "COLLECTION BOOKING"
    p.drawText(title, { x: A4[0] - M - bold.widthOfTextAtSize(title, 14), y: A4[1] - M - 16, size: 14, font: bold, color: INK })
    const ref = safe(`${b.ref}${b.vendorName ? ` - ${b.vendorName}` : ""}`).slice(0, 60)
    p.drawText(ref, { x: A4[0] - M - bold.widthOfTextAtSize(ref, 11), y: A4[1] - M - 34, size: 11, font: bold, color: NAVY })
    const pr = safe(printed)
    p.drawText(pr, { x: A4[0] - M - font.widthOfTextAtSize(pr, 8), y: A4[1] - M - 48, size: 8, font, color: MUTED })
    p.drawLine({ start: { x: M, y: A4[1] - M - 60 }, end: { x: A4[0] - M, y: A4[1] - M - 60 }, thickness: 0.8, color: NAVY })
    p.drawLine({ start: { x: M, y: M + 30 }, end: { x: A4[0] - M, y: M + 30 }, thickness: 0.5, color: LINE })
    const foot = (s: string, yy: number, size: number) => p.drawText(s, { x: (A4[0] - font.widthOfTextAtSize(s, size)) / 2, y: yy, size, font, color: MUTED })
    foot(COMPANY_LINE, M + 18, 7.5)
    foot(COMPANY_REG, M + 8, 7.5)
    const pn = `Page ${i + 1} of ${pages.length}`
    p.drawText(pn, { x: A4[0] - M - font.widthOfTextAtSize(pn, 7.5), y: M - 4, size: 7.5, font, color: MUTED })
  })

  return doc.save()
}
