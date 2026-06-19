import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { getObjectBuffer, uploadBufferToR2, getSignedImageUrl } from "@/lib/r2"
import { isValidColumn, isValidVatCode, netFromGross } from "@/lib/accounting"

export const maxDuration = 60

const r2p = (n: number) => Math.round(n * 100) / 100

function mimeForKey(key: string): string {
  const k = key.toLowerCase()
  if (k.endsWith(".pdf")) return "application/pdf"
  if (k.endsWith(".png")) return "image/png"
  if (k.endsWith(".webp")) return "image/webp"
  if (k.endsWith(".heic") || k.endsWith(".heif")) return "image/heic"
  return "image/jpeg"
}

// Validate/clamp one approved receipt before writing (don't trust the client blindly).
function clean(r: any) {
  const vatCode = isValidVatCode(Number(r?.vatCode)) ? Number(r.vatCode) : 2
  const column  = isValidColumn(r?.column) ? r.column : "vectis"
  const supplier = (r?.supplier ?? "").toString().trim().slice(0, 200)
  const item     = (r?.item ?? "").toString().trim().slice(0, 200)
  const website  = (r?.website ?? "").toString().trim().slice(0, 200)
  const gross = Number.isFinite(Number(r?.gross)) ? r2p(Number(r.gross)) : 0
  let vat = Number.isFinite(Number(r?.vat)) ? r2p(Number(r.vat)) : 0
  if (vatCode !== 1) vat = 0
  const docDate = typeof r?.docDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(r.docDate) ? new Date(r.docDate) : null
  const aiNotes = typeof r?.aiNotes === "string" && r.aiNotes.trim() ? r.aiNotes.trim().slice(0, 500) : null
  return { supplier, item, website, docDate, vatCode, gross, vat, net: netFromGross(gross, vat), column, aiNotes }
}

// Commit an approved AI proposal: receipt[0] updates the line; any further
// receipts become new lines (each with its own copy of the photo).
export async function POST(req: NextRequest) {
  try {
    const session = await auth()
    if (!session || session.user.role !== "ADMIN") {
      return NextResponse.json({ error: "Unauthorised" }, { status: 401 })
    }

    const { docId, receipts } = await req.json()
    if (!docId) return NextResponse.json({ error: "docId required" }, { status: 400 })
    const list: any[] = Array.isArray(receipts) && receipts.length ? receipts : [{}]

    const doc = await prisma.accountingDocument.findUnique({ where: { id: docId } })
    if (!doc) return NextResponse.json({ error: "Document not found" }, { status: 404 })
    const keys = (doc.images && doc.images.length) ? doc.images : (doc.imageKey ? [doc.imageKey] : [])

    const first = clean(list[0])
    await prisma.accountingDocument.update({ where: { id: doc.id }, data: { ...first, aiRun: true } })

    const extra: any[] = []
    if (list.length > 1 && keys.length) {
      const buf = await getObjectBuffer(keys[0])
      const mime = mimeForKey(keys[0])
      for (let i = 1; i < list.length && i < 20; i++) {
        const f = clean(list[i])
        const newKey = `accounts/${doc.monthId}/${Date.now()}-${i}-split.${mime === "application/pdf" ? "pdf" : "jpg"}`
        await uploadBufferToR2(buf, newKey, mime)
        const created = await prisma.accountingDocument.create({
          data: { monthId: doc.monthId, cardholder: doc.cardholder, source: "SCAN", images: [newKey], aiRun: true, ...f },
        })
        extra.push({
          id: created.id, cardholder: created.cardholder, source: "SCAN",
          images: [await getSignedImageUrl(newKey)],
          supplier: f.supplier, item: f.item, website: f.website,
          docDate: f.docDate ? f.docDate.toISOString().slice(0, 10) : "",
          vatCode: f.vatCode, gross: f.gross, vat: f.vat, net: f.net, column: f.column,
          reviewed: false, aiRun: true, aiNotes: f.aiNotes,
        })
      }
    }

    return NextResponse.json({
      id: doc.id,
      supplier: first.supplier, item: first.item, website: first.website,
      docDate: first.docDate ? first.docDate.toISOString().slice(0, 10) : "",
      vatCode: first.vatCode, gross: first.gross, vat: first.vat, net: first.net, column: first.column,
      aiNotes: first.aiNotes,
      extra,
    })
  } catch (e: any) {
    console.error("accounts/apply error:", e)
    return NextResponse.json({ error: e?.message ?? "Unknown error" }, { status: 500 })
  }
}
