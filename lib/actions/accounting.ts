"use server"

import { revalidatePath } from "next/cache"
import { prisma } from "@/lib/prisma"
import { auth } from "@/auth"
import { deleteObjectsFromR2, getObjectBuffer, uploadBufferToR2, getSignedImageUrl } from "@/lib/r2"
import { randomUUID } from "node:crypto"
import {
  netFromGross, normaliseSupplier, cleanCardholder, isValidColumn, isValidVatCode,
} from "@/lib/accounting"

async function requireAdmin() {
  const session = await auth()
  if (!session || session.user.role !== "ADMIN") throw new Error("Unauthorised")
  return session
}

// ── Cardholders (the "whose card / account" list) ────────────────────────────
export async function createCardholder(name: string) {
  await requireAdmin()
  const n = cleanCardholder(name)
  if (!n) throw new Error("Name required")
  const existing = await prisma.accountingCardholder.findUnique({ where: { name: n } })
  if (existing) return { id: existing.id }
  const max = await prisma.accountingCardholder.aggregate({ _max: { sortOrder: true } })
  const ch = await prisma.accountingCardholder.create({ data: { name: n, sortOrder: (max._max.sortOrder ?? 0) + 1 } })
  revalidatePath("/tools/accounts")
  return { id: ch.id }
}

export async function renameCardholder(id: string, name: string) {
  await requireAdmin()
  const n = cleanCardholder(name)
  if (!n) throw new Error("Name required")
  await prisma.accountingCardholder.update({ where: { id }, data: { name: n } })
  revalidatePath("/tools/accounts")
}

export async function deleteCardholder(id: string) {
  await requireAdmin()
  // Existing documents keep their stored cardholder name (history is preserved);
  // this only removes it from the pick-list going forward.
  await prisma.accountingCardholder.delete({ where: { id } })
  revalidatePath("/tools/accounts")
}

export async function createAccountingMonth(label: string) {
  await requireAdmin()
  const trimmed = label.trim()
  if (!trimmed) throw new Error("Name required")
  const existing = await prisma.accountingMonth.findUnique({ where: { label: trimmed } })
  if (existing) return { id: existing.id }
  const month = await prisma.accountingMonth.create({ data: { label: trimmed.slice(0, 60) } })
  revalidatePath("/tools/accounts")
  return { id: month.id }
}

export async function deleteAccountingMonth(id: string) {
  await requireAdmin()
  const docs = await prisma.accountingDocument.findMany({ where: { monthId: id }, select: { imageKey: true, images: true } })
  const keys = docs.flatMap((d) => [...(d.images ?? []), d.imageKey].filter((k): k is string => !!k))
  await deleteObjectsFromR2(keys)
  await prisma.accountingMonth.delete({ where: { id } })
  revalidatePath("/tools/accounts")
}

// Remove one page (by index) from a multi-page document.
export async function removeDocumentPage(docId: string, index: number) {
  await requireAdmin()
  const doc = await prisma.accountingDocument.findUnique({ where: { id: docId }, select: { images: true } })
  if (!doc) return
  const images = [...(doc.images ?? [])]
  if (index < 0 || index >= images.length) return
  const [removed] = images.splice(index, 1)
  if (removed) await deleteObjectsFromR2([removed])
  await prisma.accountingDocument.update({ where: { id: docId }, data: { images } })
}

export async function addManualDocument(monthId: string, cardholder: string) {
  await requireAdmin()
  const ch = cleanCardholder(cardholder) || "Vectis"
  const doc = await prisma.accountingDocument.create({
    data: { monthId, cardholder: ch, source: "MANUAL", supplier: "", vatCode: 2, gross: 0, vat: 0, net: 0, column: "vectis" },
  })
  revalidatePath(`/tools/accounts/${monthId}`)
  return { id: doc.id }
}

function mimeForKey(key: string): string {
  const k = key.toLowerCase()
  if (k.endsWith(".pdf")) return "application/pdf"
  if (k.endsWith(".png")) return "image/png"
  if (k.endsWith(".webp")) return "image/webp"
  if (k.endsWith(".heic") || k.endsWith(".heif")) return "image/heic"
  return "image/jpeg"
}

// Split one line into two: creates a sibling line that carries its OWN copy of
// the invoice image(s) (so deleting either keeps the other's scan), copying the
// supplier/item/date/VAT/column but starting at £0. The user then reallocates the
// amount across the two lines (e.g. accommodation vs food, which differ on VAT/nominal).
export async function splitAccountingDocument(docId: string) {
  await requireAdmin()
  const doc = await prisma.accountingDocument.findUnique({ where: { id: docId } })
  if (!doc) throw new Error("Document not found")

  const srcKeys = (doc.images && doc.images.length) ? doc.images : (doc.imageKey ? [doc.imageKey] : [])
  const newKeys: string[] = []
  for (const k of srcKeys) {
    const buf = await getObjectBuffer(k)
    const mime = mimeForKey(k)
    const ext = mime === "application/pdf" ? "pdf" : mime === "image/png" ? "png" : "jpg"
    const nk = `accounts/${doc.monthId}/${Date.now()}-${newKeys.length}-split.${ext}`
    await uploadBufferToR2(buf, nk, mime)
    newKeys.push(nk)
  }

  // All siblings of one invoice share a splitGroupId so the UI can group them.
  const groupId = doc.splitGroupId ?? randomUUID()
  if (!doc.splitGroupId) {
    await prisma.accountingDocument.update({ where: { id: doc.id }, data: { splitGroupId: groupId } })
  }

  const created = await prisma.accountingDocument.create({
    data: {
      monthId: doc.monthId, cardholder: doc.cardholder, source: doc.source, images: newKeys,
      supplier: doc.supplier, item: doc.item, website: doc.website, docDate: doc.docDate,
      vatCode: doc.vatCode, column: doc.column, gross: 0, vat: 0, net: 0, aiRun: true,
      splitGroupId: groupId, currency: doc.currency ?? "GBP",
    },
  })
  revalidatePath(`/tools/accounts/${doc.monthId}`)
  return {
    id: created.id, cardholder: created.cardholder, source: created.source,
    images: newKeys.length ? [await getSignedImageUrl(newKeys[0])] : [],
    supplier: created.supplier, item: created.item, website: created.website,
    docDate: created.docDate ? created.docDate.toISOString().slice(0, 10) : "",
    vatCode: created.vatCode, gross: created.gross, vat: created.vat, net: created.net,
    column: created.column, aiNotes: null as string | null, splitGroupId: groupId,
    currency: created.currency, originalAmount: created.originalAmount,
  }
}

export async function deleteAccountingDocument(id: string) {
  await requireAdmin()
  const doc = await prisma.accountingDocument.findUnique({ where: { id }, select: { monthId: true, imageKey: true, images: true } })
  if (!doc) return
  const keys = [...(doc.images ?? []), doc.imageKey].filter((k): k is string => !!k)
  if (keys.length) await deleteObjectsFromR2(keys)
  await prisma.accountingDocument.delete({ where: { id } })
  revalidatePath(`/tools/accounts/${doc.monthId}`)
}

type DocEdit = {
  id: string
  cardholder: string
  supplier: string
  item: string
  website: string
  docDate: string | null
  vatCode: number
  gross: number
  vat: number
  column: string
  reviewed: boolean
}

// Bulk-save the review table. Recomputes net, validates, and — for any line the
// user has ticked as reviewed — learns a supplier rule so it auto-fills next time.
export async function saveAccountingDocuments(monthId: string, edits: DocEdit[]) {
  await requireAdmin()

  for (const e of edits) {
    const cardholder = cleanCardholder(e.cardholder) || "Vectis"
    const column     = isValidColumn(e.column) ? e.column : "vectis"
    const vatCode    = isValidVatCode(Number(e.vatCode)) ? Number(e.vatCode) : 2
    const gross      = Number.isFinite(e.gross) ? Math.round(e.gross * 100) / 100 : 0
    const vat        = Number.isFinite(e.vat) ? Math.round(e.vat * 100) / 100 : 0
    const net        = netFromGross(gross, vat)
    const supplier   = (e.supplier ?? "").trim().slice(0, 200)
    const item       = (e.item ?? "").trim().slice(0, 200)
    const website    = (e.website ?? "").trim().slice(0, 200)
    const docDate    = e.docDate ? new Date(e.docDate) : null

    await prisma.accountingDocument.update({
      where: { id: e.id },
      data: { cardholder, supplier, item, website, docDate, vatCode, gross, vat, net, column, reviewed: !!e.reviewed },
    })

    // Learn from confirmed lines only.
    if (e.reviewed && supplier) {
      const match = normaliseSupplier(supplier)
      if (match) {
        await prisma.accountingSupplierRule.upsert({
          where: { match },
          create: { match, vatCode, column },
          update: { vatCode, column },
        })
      }
    }
  }

  revalidatePath(`/tools/accounts/${monthId}`)
}
