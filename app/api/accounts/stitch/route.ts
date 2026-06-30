import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { GoogleGenerativeAI } from "@google/generative-ai"
import { prisma } from "@/lib/prisma"
import { revalidatePath } from "next/cache"
import { getObjectBuffer } from "@/lib/r2"
import { getToolModel } from "@/lib/ai-models"

export const maxDuration = 120

function mimeForKey(key: string): string {
  const k = key.toLowerCase()
  if (k.endsWith(".png")) return "image/png"
  if (k.endsWith(".webp")) return "image/webp"
  if (k.endsWith(".heic") || k.endsWith(".heif")) return "image/heic"
  return "image/jpeg"
}

const STITCH_PROMPT = `You are given several photos of paper receipts/invoices, IN ORDER (photo 1, photo 2, photo 3 …). MOST photos are their own separate receipt, but SOME are extra pages of the SAME invoice (e.g. page 2 of a 2-page invoice).

Return STRICT JSON only:
{ "groups": [ [1], [2,3], [4] ] }

Each inner array lists the 1-based photo numbers that belong to ONE invoice, in order. Rules:
- Every photo number from 1 to N must appear EXACTLY ONCE across the groups.
- Only put photos in the SAME group when they are CLEARLY one invoice continued — same supplier/header, "page x of y", line items that carry on, a total on a later page. When in any doubt, keep them as SEPARATE single-photo groups.
- A normal standalone receipt is a group of one.`

export async function POST(req: NextRequest) {
  try {
    const session = await auth()
    if (!session || session.user.role !== "ADMIN") {
      return NextResponse.json({ error: "Unauthorised" }, { status: 401 })
    }
    const apiKey = process.env.GEMINI_API_KEY
    if (!apiKey) return NextResponse.json({ error: "GEMINI_API_KEY not configured" }, { status: 500 })

    const { docIds } = await req.json()
    if (!Array.isArray(docIds) || !docIds.length) return NextResponse.json({ error: "docIds required" }, { status: 400 })

    const docs = await prisma.accountingDocument.findMany({ where: { id: { in: docIds } } })
    const byId = new Map(docs.map((d) => [d.id, d]))
    // Preserve the supplied order; only single-photo (non-PDF) scans; cap at 20 per pass.
    const ordered = docIds
      .map((id: string) => byId.get(id))
      .filter((d): d is NonNullable<typeof d> => {
        if (!d) return false
        const keys = (d.images && d.images.length) ? d.images : (d.imageKey ? [d.imageKey] : [])
        return keys.length >= 1 && !keys[0].toLowerCase().endsWith(".pdf")
      })
      .slice(0, 20)
    if (ordered.length < 2) return NextResponse.json({ merged: 0, groups: [] })

    const firstKey = (d: typeof ordered[number]) => (d.images && d.images.length ? d.images[0] : d.imageKey!)
    const buffers = await Promise.all(ordered.map((d) => getObjectBuffer(firstKey(d))))
    const parts = buffers.map((buf, i) => ({ inlineData: { data: buf.toString("base64"), mimeType: mimeForKey(firstKey(ordered[i])) } }))

    const genai = new GoogleGenerativeAI(apiKey)
    const model = genai.getGenerativeModel({ model: await getToolModel("accounts_stitch"), generationConfig: { responseMimeType: "application/json" } })

    let groups: number[][] = []
    try {
      const result = await model.generateContent([...parts, { text: STITCH_PROMPT }])
      const response = result.response
      if (response.promptFeedback?.blockReason) throw new Error("blocked")
      const raw = response.text().trim().replace(/^```json\s*/i, "").replace(/```$/, "").trim()
      const parsed = JSON.parse(raw)
      if (Array.isArray(parsed?.groups)) {
        groups = parsed.groups
          .map((g: any) => Array.isArray(g) ? g.map((n: any) => Number(n)).filter((n: number) => Number.isInteger(n) && n >= 1 && n <= ordered.length) : [])
          .filter((g: number[]) => g.length > 0)
      }
    } catch { /* no grouping — leave as-is */ }

    // Merge each multi-photo group: combine its photos onto the FIRST doc (in order),
    // then delete the other docs' RECORDS only — their R2 images now live on the primary.
    let merged = 0
    for (const g of groups) {
      if (g.length < 2) continue
      const members = g.map((n) => ordered[n - 1]).filter(Boolean)
      if (members.length < 2) continue
      const primary = members[0]
      const allImages = members.flatMap((m) => (m.images && m.images.length) ? m.images : (m.imageKey ? [m.imageKey] : []))
      await prisma.accountingDocument.update({ where: { id: primary.id }, data: { images: allImages, imageKey: null, aiRun: false } })
      const others = members.slice(1).map((m) => m.id)
      if (others.length) await prisma.accountingDocument.deleteMany({ where: { id: { in: others } } })
      merged += others.length
    }

    revalidatePath(`/tools/accounts/${ordered[0].monthId}`)
    return NextResponse.json({ merged, groups })
  } catch (e: any) {
    console.error("accounts/stitch error:", e)
    return NextResponse.json({ error: e?.message ?? "Unknown error" }, { status: 500 })
  }
}
