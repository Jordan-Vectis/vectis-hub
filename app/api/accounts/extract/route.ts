import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { GoogleGenerativeAI } from "@google/generative-ai"
import { PDFDocument } from "pdf-lib"
import { prisma } from "@/lib/prisma"
import { getObjectBuffer } from "@/lib/r2"
import {
  NOMINAL_KEYS, isValidColumn, isValidVatCode,
  vatFromGross, netFromGross, normaliseSupplier,
} from "@/lib/accounting"

export const maxDuration = 120

const COLUMN_GUIDE = `Choose ONE allocation column (use the key in brackets):
- Fuel (fuel): petrol, diesel, AdBlue, fuel cards
- Meals (meals): food, meals out, subsistence, tea/coffee/milk
- Fares (fares): train/taxi/bus fares, parking, tolls, congestion charges
- Computers (computers): computer hardware, software, IT kit, online software subscriptions (e.g. Microsoft, Adobe, Canva, ChatGPT, Claude)
- Fees (fees): professional/bank/service fees
- Card Fee (cardFee): card processing/handling fees
- HGFP Stor (hgfpStor): HGFP storage costs
- Other Debtors (otherDebtors): refunds or money owed by/to third parties
- Directors (directors): a director's personal/drawings expenditure
- Vectis (vectis): general Vectis business purchases — use this as the default when unsure`

function buildPrompt(cardholder: string, allowSplit: boolean): string {
  const splitRule = allowSplit
    ? `This photo may show ONE receipt or SEVERAL separate small receipts laid out together. Return one object per SEPARATE physical receipt. Most photos have just one — only return multiple if there are clearly distinct, separate receipts.`
    : `Read the supplied page(s) as ONE single invoice/receipt and return exactly ONE object (a multi-page invoice's total/VAT is usually on the last page).`
  return `You are reading UK business expense receipts/invoices for an auction house. The card/account they belong to is "${cardholder}".
${splitRule}

Return STRICT JSON only (no prose, no markdown):
{ "receipts": [ {
  "supplier": string,        // who it was paid to, short (e.g. "Google Ads", "Shell Fuel", "Amazon")
  "item": string,            // the specific item/service bought — ONLY if clearly stated/obvious, else ""
  "website": string,         // the supplier's website/URL — ONLY if it actually appears, else ""
  "date": string|null,       // document date as YYYY-MM-DD, or null
  "gross": number,           // TOTAL paid including VAT, GBP number only
  "vat": number,             // VAT amount shown, GBP; 0 if none shown
  "vatCode": 1|2|7,          // 1 = 20% VAT shown/reclaimable; 2 = no/zero VAT; 7 = clearly personal
  "column": string,          // one of: ${NOMINAL_KEYS.join(", ")}
  "notes": string            // "" or a short note if unclear (e.g. mixed VAT)
} ] }

${COLUMN_GUIDE}

Rules:
- DO NOT GUESS "item" or "website". Only fill them if clearly visible; otherwise "". Never invent a website.
- If a VAT amount/number is shown, use vatCode 1 and put the VAT figure in "vat". If no VAT shown, vatCode 2 and vat 0.
- Numbers only for gross/vat — no symbols or commas. If a figure is unreadable, use 0 and say so in "notes".`
}

function mimeForKey(key: string): string {
  const k = key.toLowerCase()
  if (k.endsWith(".pdf")) return "application/pdf"
  if (k.endsWith(".png")) return "image/png"
  if (k.endsWith(".webp")) return "image/webp"
  if (k.endsWith(".heic") || k.endsWith(".heif")) return "image/heic"
  return "image/jpeg"
}

const r2p = (n: number) => Math.round(n * 100) / 100

async function normalise(p: any, extraNote: string | null) {
  let vatCode = isValidVatCode(Number(p?.vatCode)) ? Number(p.vatCode) : 2
  let column  = isValidColumn(p?.column) ? p.column : "vectis"
  const supplier = typeof p?.supplier === "string" ? p.supplier.trim().slice(0, 200) : ""
  const item     = typeof p?.item === "string" ? p.item.trim().slice(0, 200) : ""
  const website  = typeof p?.website === "string" ? p.website.trim().slice(0, 200) : ""
  const gross = Number.isFinite(Number(p?.gross)) ? r2p(Number(p.gross)) : 0
  let vat = Number.isFinite(Number(p?.vat)) ? r2p(Number(p.vat)) : 0
  const docDate = typeof p?.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(p.date) ? new Date(p.date) : null
  const notes = [typeof p?.notes === "string" ? p.notes.trim() : "", extraNote ? `AI: ${extraNote}` : ""]
    .filter(Boolean).join(" · ").slice(0, 500) || null

  if (supplier) {
    const rule = await prisma.accountingSupplierRule.findUnique({ where: { match: normaliseSupplier(supplier) } })
    if (rule) { vatCode = rule.vatCode; column = rule.column }
  }
  if (vatCode === 1 && vat === 0 && gross > 0) vat = vatFromGross(gross, 1)
  if (vatCode !== 1) vat = 0
  return { supplier, item, website, docDate, vatCode, gross, vat, net: netFromGross(gross, vat), column, aiNotes: notes }
}

// READER (preview, no writes). Reads ONE invoice and returns the proposed fields.
//  - `pages` given: slice the document's PDF to just those pages and read that one
//    invoice (used by the two-stage flow after /api/accounts/split).
//  - no `pages`: read the whole document. A single photo on its first read may
//    return several receipts (multi-receipt photo); otherwise exactly one.
export async function POST(req: NextRequest) {
  try {
    const session = await auth()
    if (!session || session.user.role !== "ADMIN") {
      return NextResponse.json({ error: "Unauthorised" }, { status: 401 })
    }

    const apiKey = process.env.GEMINI_API_KEY
    if (!apiKey) return NextResponse.json({ error: "GEMINI_API_KEY not configured" }, { status: 500 })

    const { docId, pages, model: modelId } = await req.json()
    if (!docId) return NextResponse.json({ error: "docId required" }, { status: 400 })

    const doc = await prisma.accountingDocument.findUnique({ where: { id: docId } })
    if (!doc) return NextResponse.json({ error: "Document not found" }, { status: 404 })
    const keys = (doc.images && doc.images.length) ? doc.images : (doc.imageKey ? [doc.imageKey] : [])
    if (!keys.length) return NextResponse.json({ error: "No scan to read" }, { status: 400 })

    const isPdfFile = keys.length === 1 && keys[0].toLowerCase().endsWith(".pdf")
    const wantPages = Array.isArray(pages) && pages.length > 0 && isPdfFile

    let imageParts: any[]
    let allowSplit: boolean
    if (wantPages) {
      // Slice the PDF to the requested pages and read just that invoice.
      const buf = await getObjectBuffer(keys[0])
      const src = await PDFDocument.load(buf)
      const count = src.getPageCount()
      const idx = (pages as any[]).map((n) => Number(n) - 1).filter((n) => Number.isInteger(n) && n >= 0 && n < count)
      const out = await PDFDocument.create()
      const copied = await out.copyPages(src, idx.length ? idx : [0])
      copied.forEach((pg) => out.addPage(pg))
      const bytes = Buffer.from(await out.save())
      imageParts = [{ inlineData: { data: bytes.toString("base64"), mimeType: "application/pdf" } }]
      allowSplit = false
    } else {
      const buffers = await Promise.all(keys.slice(0, 12).map((k) => getObjectBuffer(k)))
      imageParts = buffers.map((buf, idx) => ({ inlineData: { data: buf.toString("base64"), mimeType: mimeForKey(keys[idx]) } }))
      // Photos can hold several receipts; PDFs are split by /api/accounts/split instead.
      allowSplit = keys.length === 1 && !doc.aiRun && !isPdfFile
    }

    const genai = new GoogleGenerativeAI(apiKey)
    const model = genai.getGenerativeModel({
      model: modelId || "gemini-3-flash-preview",
      generationConfig: { responseMimeType: "application/json" },
    })

    let receipts: any[] = []
    let aiError: string | null = null
    try {
      const result = await model.generateContent([...imageParts, { text: buildPrompt(doc.cardholder, allowSplit) }])
      const response = result.response
      const block = response.promptFeedback?.blockReason
      if (block) throw new Error(`Blocked (prompt): ${block}`)
      const finish = response.candidates?.[0]?.finishReason
      if (finish && finish !== "STOP" && finish !== "MAX_TOKENS") throw new Error(`Blocked (${finish})`)
      const raw = response.text().trim().replace(/^```json\s*/i, "").replace(/```$/, "").trim()
      const parsed = JSON.parse(raw)
      receipts = Array.isArray(parsed?.receipts) ? parsed.receipts : (parsed?.supplier !== undefined ? [parsed] : [])
    } catch (e: any) {
      aiError = e?.message ?? "AI could not read this document"
    }
    if (receipts.length === 0) receipts = [{}]
    if (!allowSplit) receipts = receipts.slice(0, 1)
    let capped = false
    if (receipts.length > 200) { capped = true; receipts = receipts.slice(0, 200) }

    const proposals = []
    for (let i = 0; i < receipts.length; i++) {
      const f = await normalise(receipts[i], i === 0 ? aiError : null)
      proposals.push({
        supplier: f.supplier, item: f.item, website: f.website,
        docDate: f.docDate ? f.docDate.toISOString().slice(0, 10) : "",
        vatCode: f.vatCode, gross: f.gross, vat: f.vat, net: f.net, column: f.column, aiNotes: f.aiNotes,
      })
    }

    return NextResponse.json({ docId: doc.id, receipts: proposals, capped })
  } catch (e: any) {
    console.error("accounts/extract error:", e)
    return NextResponse.json({ error: e?.message ?? "Unknown error" }, { status: 500 })
  }
}
