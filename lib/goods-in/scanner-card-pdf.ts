import { PDFDocument, StandardFonts, rgb, type PDFFont } from "pdf-lib"
import bwipjs from "bwip-js"
import { embedVectisLogo } from "@/lib/pdf-logo"
import { safe } from "./pdf"

// Goods In → Scanner cards: the sign-in card for the handheld scanner. SERVER ONLY.
//
// One 100 × 50 mm page, the same size as the tote labels (any label printer prints a PDF page),
// with a big QR code of EXACTLY the card's code on the left and the person's name on the right.
// ⚠ This PDF is the ONLY place a card's code ever exists outside the scanner — the Hub keeps only
// its hash — so it is built in memory, answered once and never saved or logged, and the code is
// never drawn as text. The QR is drawn as vector squares (bwip-js "qrcode", raw modules), so it
// prints sharp on a thermal printer at any resolution rather than as a scaled, smoothed picture.

const INK = rgb(0.1, 0.1, 0.1)
const MUTED = rgb(0.38, 0.38, 0.38)
const NAVY = rgb(0.18, 0.196, 0.557)

const MM = 72 / 25.4

/** bwip-js's raw encoder (in the package, but not in the Hub's slim types/bwip-js.d.ts): a 2D
 *  symbol's modules, row by row from the top, 1 = dark. */
type BwipRaw = { raw: (o: { bcid: string; text: string; eclevel?: string }) => { pixs: number[]; pixx: number; pixy: number }[] }

export type ScannerCardForPdf = {
  /** Who the card signs in. */
  name: string
  /** The card's code — what the QR holds, exactly. Never drawn as text. */
  code: string
  /** "Production", "Staging" or "Sandbox" — which Hub the card works on. */
  hubName: string
  createdAt: Date
}

const longDate = (d: Date) => new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", day: "numeric", month: "long", year: "numeric" }).format(d)

/**
 * `text` as at most `max` lines no wider than `width`; a word wider than a line is broken. When it
 * doesn't all fit, the last line ends "..." and `cut` is true.
 */
function fitLines(text: string, font: PDFFont, size: number, width: number, max: number): { lines: string[]; cut: boolean } {
  const fits = (t: string) => font.widthOfTextAtSize(t, size) <= width
  const out: string[] = []
  let line = ""
  for (let w of safe(text).split(/\s+/).filter(Boolean)) {
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
  if (line) out.push(line)
  if (out.length <= max) return { lines: out, cut: false }
  const kept = out.slice(0, max)
  let last = kept[max - 1]
  while (last.length > 1 && !fits(`${last}...`)) last = last.slice(0, -1)
  kept[max - 1] = `${last.trimEnd()}...`
  return { lines: kept, cut: true }
}

export async function buildScannerCardPdf(card: ScannerCardForPdf): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  doc.setTitle("Vectis Scanner sign-in card")
  doc.setAuthor("Vectis Auctions")
  const font = await doc.embedFont(StandardFonts.Helvetica)
  const bold = await doc.embedFont(StandardFonts.HelveticaBold)

  const PW = 100 * MM, PH = 50 * MM
  const page = doc.addPage([PW, PH])

  // ── The QR, on the left: a square the full height of the card less a 2 mm margin, with the
  // four-module white quiet zone a scanner needs inside it. Error correction Q, so a scuffed card
  // still reads. ──
  const qr = (bwipjs as unknown as BwipRaw).raw({ bcid: "qrcode", text: card.code, eclevel: "Q" })[0]
  if (!qr || !Array.isArray(qr.pixs) || !(qr.pixx > 0) || qr.pixs.length !== qr.pixx * qr.pixy) throw new Error("The QR code couldn't be made.")
  const QUIET = 4
  const margin = 2 * MM
  const side = PH - 2 * margin
  const mod = side / (qr.pixx + 2 * QUIET)
  const qx = margin + QUIET * mod
  const qyTop = PH - margin - QUIET * mod
  for (let row = 0; row < qr.pixy; row++) {
    // Each run of dark modules along a row is one rectangle — fewer, cleaner shapes than one per module.
    let col = 0
    while (col < qr.pixx) {
      if (!qr.pixs[row * qr.pixx + col]) { col++; continue }
      const start = col
      while (col < qr.pixx && qr.pixs[row * qr.pixx + col]) col++
      page.drawRectangle({ x: qx + start * mod, y: qyTop - (row + 1) * mod, width: (col - start) * mod, height: mod, color: rgb(0, 0, 0) })
    }
  }

  // ── The words, on the right ──
  const x = margin + side
  const pad = 3.5 * MM
  const W = PW - x - pad
  let y = PH - pad

  // The logo is a nicety — a card without it still signs someone in.
  try {
    const logo = await embedVectisLogo(doc)
    const h = 9
    const w = Math.min(W, (logo.width / logo.height) * h)
    page.drawImage(logo, { x, y: y - h, width: w, height: (logo.height / logo.width) * w })
    y -= h + 5
  } catch (e) {
    console.error("scanner card: couldn't add the logo:", (e as Error)?.message ?? e)
  }

  const kicker = "Vectis Scanner - sign-in card"
  let kSize = 7.5
  while (bold.widthOfTextAtSize(kicker, kSize) > W && kSize > 5.5) kSize -= 0.5
  page.drawText(kicker, { x, y: y - kSize, size: kSize, font: bold, color: NAVY })
  y -= kSize + 6

  // The name as big as it can be: one line at 16pt down to 13pt; a longer name takes two lines,
  // from 14pt down to 11pt, then three at 10pt; only a name too long even for that is cut short with "...".
  const name = card.name?.trim() || "-"
  let nSize = 16
  let fit = fitLines(name, bold, nSize, W, 1)
  while (fit.cut && nSize > 13) fit = fitLines(name, bold, --nSize, W, 1)
  if (fit.cut) {
    nSize = 14
    fit = fitLines(name, bold, nSize, W, 2)
    while (fit.cut && nSize > 11) fit = fitLines(name, bold, --nSize, W, 2)
  }
  if (fit.cut) fit = fitLines(name, bold, (nSize = 10), W, 3)
  for (const l of fit.lines) {
    page.drawText(l, { x, y: y - nSize * 0.8, size: nSize, font: bold, color: INK })
    y -= nSize * 1.1
  }
  y -= 3

  const meta = `${safe(card.hubName)} Hub · ${longDate(card.createdAt)}`
  for (const l of fitLines(meta, font, 7.5, W, 2).lines) {
    page.drawText(l, { x, y: y - 7.5, size: 7.5, font, color: MUTED })
    y -= 9.5
  }

  // The warning, anchored to the foot of the card.
  const warn = fitLines("Keep it safe: it signs you in to the scanner. Lost it? Cancel it in Goods In > Scanner cards.", font, 6.5, W, 4).lines
  let wy = pad + (warn.length - 1) * 8
  for (const l of warn) {
    page.drawText(l, { x, y: wy, size: 6.5, font, color: INK })
    wy -= 8
  }

  return doc.save()
}
