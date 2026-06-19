import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { GoogleGenerativeAI } from "@google/generative-ai"
import { prisma } from "@/lib/prisma"
import { getObjectBuffer } from "@/lib/r2"
import {
  NOMINAL_KEYS, isValidColumn, isValidVatCode,
  vatFromGross, netFromGross, normaliseSupplier,
} from "@/lib/accounting"

export const maxDuration = 60

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

function buildPrompt(cardholder: string): string {
  return `You are reading a UK business expense document (an invoice, bill or receipt) for an auction house. The card/account it belongs to is "${cardholder}". If more than one image is supplied, they are the PAGES OF THE SAME document — read them together as one invoice (totals/VAT are usually on the last page).

Extract the following and return STRICT JSON only (no prose, no markdown):
{
  "supplier": string,        // who it was paid to, short (e.g. "Google Ads", "Shell Fuel", "Amazon")
  "item": string,            // the specific item or service bought — ONLY if clearly stated/obvious on the document, else ""
  "website": string,         // the supplier's website/URL — ONLY if it actually appears on the document, else ""
  "date": string|null,       // the document date as YYYY-MM-DD, or null if not visible
  "gross": number,           // the TOTAL amount paid including VAT, in GBP (just the number)
  "vat": number,             // the VAT amount shown, in GBP; 0 if no VAT is shown
  "vatCode": 1|2|7,          // 1 = standard 20% VAT is shown and reclaimable; 2 = no/zero VAT shown; 7 = clearly personal
  "column": string,          // one of: ${NOMINAL_KEYS.join(", ")}
  "notes": string            // empty string, or a short note if something is unclear/needs checking (e.g. mixed VAT items)
}

${COLUMN_GUIDE}

Rules:
- DO NOT GUESS "item" or "website". Only fill them if they are clearly visible/obvious on the document; otherwise return "" for them. Never invent a website.
- If a VAT amount or VAT number is shown, use vatCode 1 and put the VAT figure in "vat".
- If no VAT is shown (common for subscriptions billed abroad, postage, insurance), use vatCode 2 and vat 0.
- Numbers only for gross/vat — no currency symbols or commas.
- If you genuinely cannot read a figure, use 0 and explain in "notes".`
}

function mimeForKey(key: string): string {
  const k = key.toLowerCase()
  if (k.endsWith(".pdf")) return "application/pdf"
  if (k.endsWith(".png")) return "image/png"
  if (k.endsWith(".webp")) return "image/webp"
  if (k.endsWith(".heic") || k.endsWith(".heif")) return "image/heic"
  return "image/jpeg"
}

// Runs the AI over ONE already-uploaded document (by id) and fills in its details.
export async function POST(req: NextRequest) {
  try {
    const session = await auth()
    if (!session || session.user.role !== "ADMIN") {
      return NextResponse.json({ error: "Unauthorised" }, { status: 401 })
    }

    const apiKey = process.env.GEMINI_API_KEY
    if (!apiKey) return NextResponse.json({ error: "GEMINI_API_KEY not configured" }, { status: 500 })

    const { docId, model: modelId } = await req.json()
    if (!docId) return NextResponse.json({ error: "docId required" }, { status: 400 })

    const doc = await prisma.accountingDocument.findUnique({ where: { id: docId } })
    if (!doc) return NextResponse.json({ error: "Document not found" }, { status: 404 })
    const keys = (doc.images && doc.images.length) ? doc.images : (doc.imageKey ? [doc.imageKey] : [])
    if (!keys.length) return NextResponse.json({ error: "No scan to read" }, { status: 400 })

    // Send every page of the document (capped) to the model together.
    const imageParts = await Promise.all(keys.slice(0, 12).map(async (k) => {
      const buf = await getObjectBuffer(k)
      return { inlineData: { data: buf.toString("base64"), mimeType: mimeForKey(k) } }
    }))

    const genai = new GoogleGenerativeAI(apiKey)
    const model = genai.getGenerativeModel({
      model: modelId || "gemini-3-flash-preview",
      generationConfig: { responseMimeType: "application/json" },
    })

    let parsed: any = {}
    let aiError: string | null = null
    try {
      const result = await model.generateContent([
        ...imageParts,
        { text: buildPrompt(doc.cardholder) },
      ])
      const response = result.response
      const block = response.promptFeedback?.blockReason
      if (block) throw new Error(`Blocked (prompt): ${block}`)
      const finish = response.candidates?.[0]?.finishReason
      if (finish && finish !== "STOP" && finish !== "MAX_TOKENS") throw new Error(`Blocked (${finish})`)
      const raw = response.text().trim().replace(/^```json\s*/i, "").replace(/```$/, "").trim()
      parsed = JSON.parse(raw)
    } catch (e: any) {
      aiError = e?.message ?? "AI could not read this document"
    }

    // Sanitise the AI output.
    let vatCode = isValidVatCode(Number(parsed.vatCode)) ? Number(parsed.vatCode) : 2
    let column  = isValidColumn(parsed.column) ? parsed.column : "vectis"
    const supplier = typeof parsed.supplier === "string" ? parsed.supplier.trim().slice(0, 200) : ""
    const item    = typeof parsed.item === "string" ? parsed.item.trim().slice(0, 200) : ""
    const website = typeof parsed.website === "string" ? parsed.website.trim().slice(0, 200) : ""
    const gross = Number.isFinite(Number(parsed.gross)) ? Math.round(Number(parsed.gross) * 100) / 100 : 0
    let vat = Number.isFinite(Number(parsed.vat)) ? Math.round(Number(parsed.vat) * 100) / 100 : 0
    const docDate = typeof parsed.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(parsed.date) ? new Date(parsed.date) : null
    const notes = [typeof parsed.notes === "string" ? parsed.notes.trim() : "", aiError ? `AI: ${aiError}` : ""]
      .filter(Boolean).join(" · ").slice(0, 500) || null

    // A learned supplier rule beats the AI's guess at category.
    if (supplier) {
      const rule = await prisma.accountingSupplierRule.findUnique({ where: { match: normaliseSupplier(supplier) } })
      if (rule) { vatCode = rule.vatCode; column = rule.column }
    }

    // For a standard-rated line with no VAT figure read, fall back to gross/6.
    if (vatCode === 1 && vat === 0 && gross > 0) vat = vatFromGross(gross, 1)
    if (vatCode !== 1) vat = 0
    const net = netFromGross(gross, vat)

    await prisma.accountingDocument.update({
      where: { id: doc.id },
      data: { supplier, item, website, docDate, vatCode, gross, vat, net, column, aiNotes: notes, aiRun: true },
    })

    return NextResponse.json({
      id: doc.id,
      supplier, item, website,
      docDate: docDate ? docDate.toISOString().slice(0, 10) : "",
      vatCode, gross, vat, net, column,
      aiNotes: notes,
    })
  } catch (e: any) {
    console.error("accounts/extract error:", e)
    return NextResponse.json({ error: e?.message ?? "Unknown error" }, { status: 500 })
  }
}
