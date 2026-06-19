"use server"

import { revalidatePath } from "next/cache"
import { prisma } from "@/lib/prisma"
import { auth } from "@/auth"
import { deleteObjectsFromR2 } from "@/lib/r2"
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
  const docs = await prisma.accountingDocument.findMany({ where: { monthId: id }, select: { imageKey: true } })
  const keys = docs.map((d) => d.imageKey).filter((k): k is string => !!k)
  await deleteObjectsFromR2(keys)
  await prisma.accountingMonth.delete({ where: { id } })
  revalidatePath("/tools/accounts")
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

export async function deleteAccountingDocument(id: string) {
  await requireAdmin()
  const doc = await prisma.accountingDocument.findUnique({ where: { id }, select: { monthId: true, imageKey: true } })
  if (!doc) return
  if (doc.imageKey) await deleteObjectsFromR2([doc.imageKey])
  await prisma.accountingDocument.delete({ where: { id } })
  revalidatePath(`/tools/accounts/${doc.monthId}`)
}

type DocEdit = {
  id: string
  cardholder: string
  supplier: string
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
    const docDate    = e.docDate ? new Date(e.docDate) : null

    await prisma.accountingDocument.update({
      where: { id: e.id },
      data: { cardholder, supplier, docDate, vatCode, gross, vat, net, column, reviewed: !!e.reviewed },
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
