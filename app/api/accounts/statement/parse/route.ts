import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { GoogleGenerativeAI } from "@google/generative-ai"
import { prisma } from "@/lib/prisma"
import { getObjectBuffer } from "@/lib/r2"
import { getToolModel } from "@/lib/ai-models"

export const maxDuration = 180

function mimeForKey(key: string): string {
  const k = key.toLowerCase()
  if (k.endsWith(".pdf")) return "application/pdf"
  if (k.endsWith(".png")) return "image/png"
  if (k.endsWith(".webp")) return "image/webp"
  if (k.endsWith(".heic") || k.endsWith(".heif")) return "image/heic"
  return "image/jpeg"
}

const r2p = (n: number) => Math.round(n * 100) / 100

const PROMPT = `You are reading a UK business bank / credit-card statement (e.g. NatWest OneCard). Extract EVERY individual transaction line across ALL the supplied pages.

Return STRICT JSON only (no prose, no markdown):
{ "transactions": [ {
  "postDate": "YYYY-MM-DD"|null,    // posting date (left column) — null if unclear
  "tranDate": "YYYY-MM-DD"|null,    // transaction date — null if unclear
  "description": string,             // the merchant / transaction description as shown
  "reference": string,               // "Your Ref" / bank reference if shown, else ""
  "amount": number,                  // the GBP figure in the Amount column (what was charged)
  "currency": string,                // "GBP" unless the line is a foreign charge (then its ISO code, e.g. "EUR","USD")
  "originalAmount": number|null,     // the foreign amount if the line shows one (e.g. 99 for "99.00 EUR"), else null
  "fee": number|null,                // non-sterling transaction fee if shown (e.g. 2.54), else null
  "direction": "DEBIT"|"CREDIT"      // CREDIT for payments received / refunds (money in); DEBIT for purchases
} ] }

Rules:
- ONE object per transaction line. Read every page you are given.
- "amount" is ALWAYS the GBP figure in the Amount column.
- Foreign charges: the statement shows the original amount then "EXCHANGE RATE ..." and sometimes "INCL NON-STERLING TRANSACTION FEE £x" on the next line(s). Put the foreign amount in "originalAmount", its currency in "currency", the fee in "fee", and keep the GBP charged in "amount". Attach those extra lines to the SAME transaction object — do not make them separate transactions.
- Dates often omit the year — use the year(s) from the statement's date-range header (e.g. "29 April - 28 May 2026").
- Numbers only — no £ signs or commas (1,234.56 -> 1234.56).
- DO NOT include summary, subtotal, total, balance, credit-limit, interest or "payment due" lines — only real transactions.`

function parseDate(s: any): Date | null {
  if (typeof s !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return null
  const d = new Date(s)
  return isNaN(d.getTime()) ? null : d
}

export async function POST(req: NextRequest) {
  try {
    const session = await auth()
    if (!session || session.user.role !== "ADMIN") {
      return NextResponse.json({ error: "Unauthorised" }, { status: 401 })
    }

    const apiKey = process.env.GEMINI_API_KEY
    if (!apiKey) return NextResponse.json({ error: "GEMINI_API_KEY not configured" }, { status: 500 })

    const { statementId, model: modelId } = await req.json()
    if (!statementId) return NextResponse.json({ error: "statementId required" }, { status: 400 })

    const stmt = await prisma.bankStatement.findUnique({ where: { id: statementId } })
    if (!stmt) return NextResponse.json({ error: "Statement not found" }, { status: 404 })
    const keys = (stmt.images ?? []).slice(0, 12)
    if (!keys.length) return NextResponse.json({ error: "No statement pages to read" }, { status: 400 })

    const buffers = await Promise.all(keys.map((k) => getObjectBuffer(k)))
    const parts = buffers.map((buf, i) => ({ inlineData: { data: buf.toString("base64"), mimeType: mimeForKey(keys[i]) } }))

    const genai = new GoogleGenerativeAI(apiKey)
    const model = genai.getGenerativeModel({
      model: await getToolModel("accounts_statement", modelId),
      generationConfig: { responseMimeType: "application/json" },
    })

    const result = await model.generateContent([...parts, { text: PROMPT }])
    const response = result.response
    const block = response.promptFeedback?.blockReason
    if (block) return NextResponse.json({ error: `Blocked (prompt): ${block}` }, { status: 422 })
    const finish = response.candidates?.[0]?.finishReason
    if (finish && finish !== "STOP" && finish !== "MAX_TOKENS") return NextResponse.json({ error: `Blocked (${finish})` }, { status: 422 })

    const raw = response.text().trim().replace(/^```json\s*/i, "").replace(/```$/, "").trim()
    const parsed = JSON.parse(raw)
    const txns: any[] = Array.isArray(parsed?.transactions) ? parsed.transactions : []

    const data = txns.slice(0, 1000).map((t) => {
      const currency = (typeof t?.currency === "string" && t.currency.trim() ? t.currency.trim().toUpperCase().slice(0, 8) : "GBP")
      const amount = Number.isFinite(Number(t?.amount)) ? r2p(Math.abs(Number(t.amount))) : 0
      const originalAmount = currency !== "GBP" && Number.isFinite(Number(t?.originalAmount)) && Number(t.originalAmount) > 0 ? r2p(Number(t.originalAmount)) : null
      const fee = Number.isFinite(Number(t?.fee)) && Number(t.fee) > 0 ? r2p(Number(t.fee)) : null
      const direction = (t?.direction === "CREDIT") ? "CREDIT" : "DEBIT"
      return {
        statementId: stmt.id,
        monthId: stmt.monthId,
        postDate: parseDate(t?.postDate),
        tranDate: parseDate(t?.tranDate),
        description: (typeof t?.description === "string" ? t.description : "").trim().slice(0, 300),
        reference: (typeof t?.reference === "string" ? t.reference : "").trim().slice(0, 120),
        amount, currency, originalAmount, feeAmount: fee, direction,
      }
    })

    // Re-parsing replaces the statement's transactions (and any prior matches on them).
    await prisma.bankTransaction.deleteMany({ where: { statementId: stmt.id } })
    if (data.length) await prisma.bankTransaction.createMany({ data })

    return NextResponse.json({ count: data.length })
  } catch (e: any) {
    console.error("statement/parse error:", e)
    return NextResponse.json({ error: e?.message ?? "Unknown error" }, { status: 500 })
  }
}
