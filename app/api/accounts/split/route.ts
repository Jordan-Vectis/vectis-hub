import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { GoogleGenerativeAI } from "@google/generative-ai"
import { PDFDocument } from "pdf-lib"
import { prisma } from "@/lib/prisma"
import { getObjectBuffer } from "@/lib/r2"
import { getToolModel } from "@/lib/ai-models"

export const maxDuration = 120

const SPLIT_PROMPT = `This is a PDF that was scanned from a stack of paper. It may contain ONE invoice/receipt or SEVERAL completely separate ones. Work out where each separate invoice/receipt starts and ends.

Return STRICT JSON only:
{ "groups": [ [1,2], [3], [4,5,6] ] }

Each inner array lists the 1-based page numbers that belong to ONE invoice/receipt, in order. Rules:
- Every page must belong to exactly one group, and groups must cover all pages in order.
- A single invoice often spans several pages — keep those pages in the SAME group.
- Only start a new group when a genuinely different invoice/receipt begins (different supplier, a fresh header/"invoice"/"receipt" at the top, a new total, etc.).
- If the whole PDF is just one invoice, return one group containing all the pages.`

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
    // Only PDFs are page-splittable; the client handles photos via /extract.
    if (keys.length !== 1 || !keys[0].toLowerCase().endsWith(".pdf")) {
      return NextResponse.json({ groups: [], capped: false })
    }

    const buf = await getObjectBuffer(keys[0])
    let pageCount = 0
    try { pageCount = (await PDFDocument.load(buf)).getPageCount() } catch { /* unreadable */ }

    const genai = new GoogleGenerativeAI(apiKey)
    const model = genai.getGenerativeModel({ model: modelId || (await getToolModel("accounts_split")), generationConfig: { responseMimeType: "application/json" } })

    let groups: number[][] = []
    try {
      const result = await model.generateContent([
        { inlineData: { data: buf.toString("base64"), mimeType: "application/pdf" } },
        { text: SPLIT_PROMPT },
      ])
      const response = result.response
      if (response.promptFeedback?.blockReason) throw new Error("blocked")
      const raw = response.text().trim().replace(/^```json\s*/i, "").replace(/```$/, "").trim()
      const parsed = JSON.parse(raw)
      if (Array.isArray(parsed?.groups)) {
        groups = parsed.groups
          .map((g: any) => Array.isArray(g)
            ? g.map((n: any) => Number(n)).filter((n: number) => Number.isInteger(n) && n >= 1 && (!pageCount || n <= pageCount))
            : [])
          .filter((g: number[]) => g.length > 0)
      }
    } catch { /* fall back to single below */ }

    // Fall back to "whole PDF as one" if the split couldn't be determined.
    if (groups.length === 0) groups = pageCount ? [Array.from({ length: pageCount }, (_, i) => i + 1)] : []

    const capped = groups.length > 200
    if (capped) groups = groups.slice(0, 200)

    return NextResponse.json({ groups, capped })
  } catch (e: any) {
    console.error("accounts/split error:", e)
    return NextResponse.json({ error: e?.message ?? "Unknown error" }, { status: 500 })
  }
}
