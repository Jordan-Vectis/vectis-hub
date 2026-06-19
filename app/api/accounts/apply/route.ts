import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { PDFDocument } from "pdf-lib"
import { prisma } from "@/lib/prisma"
import { getObjectBuffer, uploadBufferToR2, getSignedImageUrl, deleteObjectsFromR2 } from "@/lib/r2"
import { isValidColumn, isValidVatCode, netFromGross } from "@/lib/accounting"

export const maxDuration = 300

const r2p = (n: number) => Math.round(n * 100) / 100

function mimeForKey(key: string): string {
  const k = key.toLowerCase()
  if (k.endsWith(".pdf")) return "application/pdf"
  if (k.endsWith(".png")) return "image/png"
  if (k.endsWith(".webp")) return "image/webp"
  if (k.endsWith(".heic") || k.endsWith(".heif")) return "image/heic"
  return "image/jpeg"
}

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
  const pages = Array.isArray(r?.pages) ? r.pages.map((n: any) => Number(n)).filter((n: number) => Number.isInteger(n) && n >= 1) : []
  return { supplier, item, website, docDate, vatCode, gross, vat, net: netFromGross(gross, vat), column, aiNotes, pages }
}

// Commit an approved AI proposal. receipt[0] updates the line; further receipts
// become new lines. For a multi-invoice PDF, each line gets its OWN pages sliced
// out of the original PDF; for a photo, lines share a copy of the image.
export async function POST(req: NextRequest) {
  try {
    const session = await auth()
    if (!session || session.user.role !== "ADMIN") {
      return NextResponse.json({ error: "Unauthorised" }, { status: 401 })
    }

    const { docId, receipts } = await req.json()
    if (!docId) return NextResponse.json({ error: "docId required" }, { status: 400 })
    const list: any[] = (Array.isArray(receipts) && receipts.length ? receipts : [{}]).map(clean)

    const doc = await prisma.accountingDocument.findUnique({ where: { id: docId } })
    if (!doc) return NextResponse.json({ error: "Document not found" }, { status: 404 })
    const keys = (doc.images && doc.images.length) ? doc.images : (doc.imageKey ? [doc.imageKey] : [])

    const isPdfSource = keys.length === 1 && keys[0].toLowerCase().endsWith(".pdf")
    const needBuffer = keys.length > 0 && (list.length > 1 || (isPdfSource && (list[0].pages?.length ?? 0) > 0))
    const buf = needBuffer ? await getObjectBuffer(keys[0]) : null
    const srcPdf = isPdfSource && buf ? await PDFDocument.load(buf) : null
    const pageCount = srcPdf ? srcPdf.getPageCount() : 0
    let n = 0

    // The images[] for one receipt: a sliced PDF of its own pages where possible,
    // otherwise a copy of the whole original (or the original itself for receipt 0).
    async function imagesFor(rec: any, isPrimary: boolean): Promise<string[]> {
      if (srcPdf && rec.pages?.length) {
        const idx = (rec.pages as number[]).map((p) => p - 1).filter((p) => p >= 0 && p < pageCount)
        if (idx.length) {
          const out = await PDFDocument.create()
          const copied = await out.copyPages(srcPdf, Array.from(new Set(idx)).sort((a, b) => a - b))
          copied.forEach((pg) => out.addPage(pg))
          const bytes = Buffer.from(await out.save())
          const key = `accounts/${doc!.monthId}/${Date.now()}-${n++}-inv.pdf`
          await uploadBufferToR2(bytes, key, "application/pdf")
          return [key]
        }
      }
      if (isPrimary) return keys                 // keep the original on the primary line
      const mime = mimeForKey(keys[0])           // copy the whole original for an extra line
      const key = `accounts/${doc!.monthId}/${Date.now()}-${n++}-split.${mime === "application/pdf" ? "pdf" : "jpg"}`
      await uploadBufferToR2(buf!, key, mime)
      return [key]
    }

    const primaryImages = await imagesFor(list[0], true)
    const { pages: _p0, ...firstData } = list[0]
    await prisma.accountingDocument.update({ where: { id: doc.id }, data: { ...firstData, images: primaryImages, aiRun: true } })

    const extra: any[] = []
    for (let i = 1; i < list.length && i < 200; i++) {
      const { pages: _pi, ...f } = list[i]
      const imgs = await imagesFor(list[i], false)
      const created = await prisma.accountingDocument.create({
        data: { monthId: doc.monthId, cardholder: doc.cardholder, source: "SCAN", images: imgs, aiRun: true, ...f },
      })
      extra.push({
        id: created.id, cardholder: created.cardholder, source: "SCAN",
        images: [await getSignedImageUrl(imgs[0])],
        supplier: f.supplier, item: f.item, website: f.website,
        docDate: f.docDate ? f.docDate.toISOString().slice(0, 10) : "",
        vatCode: f.vatCode, gross: f.gross, vat: f.vat, net: f.net, column: f.column,
        reviewed: false, aiRun: true, aiNotes: f.aiNotes,
      })
    }

    // If the primary line was re-sliced, the original whole PDF is no longer used.
    if (primaryImages[0] !== keys[0] && keys[0]) await deleteObjectsFromR2([keys[0]])

    return NextResponse.json({
      id: doc.id,
      supplier: firstData.supplier, item: firstData.item, website: firstData.website,
      docDate: firstData.docDate ? firstData.docDate.toISOString().slice(0, 10) : "",
      vatCode: firstData.vatCode, gross: firstData.gross, vat: firstData.vat, net: firstData.net, column: firstData.column,
      aiNotes: firstData.aiNotes,
      images: [await getSignedImageUrl(primaryImages[0])],
      extra,
    })
  } catch (e: any) {
    console.error("accounts/apply error:", e)
    return NextResponse.json({ error: e?.message ?? "Unknown error" }, { status: 500 })
  }
}
