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

// ── Bank/card statement reconciliation ───────────────────────────────────────
const r2p = (n: number) => Math.round((Number(n) || 0) * 100) / 100

export async function deleteBankStatement(id: string) {
  await requireAdmin()
  const stmt = await prisma.bankStatement.findUnique({ where: { id }, select: { monthId: true, images: true } })
  if (!stmt) return
  if (stmt.images.length) await deleteObjectsFromR2(stmt.images)
  await prisma.bankStatement.delete({ where: { id } })   // cascades transactions
  revalidatePath(`/tools/accounts/${stmt.monthId}`)
}

export async function setTransactionMatch(txnId: string, docIds: string[]) {
  await requireAdmin()
  const t = await prisma.bankTransaction.findUnique({ where: { id: txnId }, select: { monthId: true } })
  if (!t) return
  await prisma.bankTransaction.update({ where: { id: txnId }, data: { matchedDocIds: docIds.slice(0, 50) } })
  revalidatePath(`/tools/accounts/${t.monthId}`)
}

export async function setTransactionIgnored(txnId: string, ignored: boolean) {
  await requireAdmin()
  const t = await prisma.bankTransaction.findUnique({ where: { id: txnId }, select: { monthId: true } })
  if (!t) return
  await prisma.bankTransaction.update({ where: { id: txnId }, data: { ignored } })
  revalidatePath(`/tools/accounts/${t.monthId}`)
}

// Set an entered line's gross to the bank's exact GBP (used to "snap" a foreign
// charge once it's matched, since the bank's settled GBP is the true cost).
export async function snapDocAmount(docId: string, amount: number) {
  await requireAdmin()
  const doc = await prisma.accountingDocument.findUnique({ where: { id: docId } })
  if (!doc) return
  const gross = r2p(amount)
  const vat = doc.vatCode === 1 ? r2p(gross / 6) : 0
  await prisma.accountingDocument.update({ where: { id: docId }, data: { gross, vat, net: r2p(gross - vat) } })
  revalidatePath(`/tools/accounts/${doc.monthId}`)
}

// Auto-match a statement's transactions to entered lines. A non-split line is one
// unit; a split invoice is one unit (its parts summed). Matches on exact GBP, or on
// the foreign amount for foreign charges. Only assigns a UNIQUE confident match
// (ties broken by nearest date, else left for manual review). Never double-assigns.
export async function autoMatchStatement(statementId: string) {
  await requireAdmin()
  const stmt = await prisma.bankStatement.findUnique({ where: { id: statementId } })
  if (!stmt) throw new Error("Statement not found")
  const txns = await prisma.bankTransaction.findMany({ where: { statementId }, orderBy: { createdAt: "asc" } })
  // Only match against entries for THIS statement's cardholder (each card has its own statement).
  const docs = await prisma.accountingDocument.findMany({
    where: { monthId: stmt.monthId, ...(stmt.cardholder ? { cardholder: stmt.cardholder } : {}) },
  })

  type Unit = { docIds: string[]; amount: number; currency: string; originalAmount: number | null; date: Date | null }
  const units: Unit[] = []
  const groups = new Map<string, typeof docs>()
  for (const d of docs) {
    if (d.splitGroupId) { const a = groups.get(d.splitGroupId) ?? []; a.push(d); groups.set(d.splitGroupId, a) }
    else units.push({ docIds: [d.id], amount: r2p(d.gross), currency: d.currency ?? "GBP", originalAmount: d.originalAmount ?? null, date: d.docDate })
  }
  for (const [, arr] of groups) {
    if (arr.length === 1) { const d = arr[0]; units.push({ docIds: [d.id], amount: r2p(d.gross), currency: d.currency ?? "GBP", originalAmount: d.originalAmount ?? null, date: d.docDate }) }
    else units.push({ docIds: arr.map((d) => d.id), amount: r2p(arr.reduce((a, d) => a + d.gross, 0)), currency: arr[0].currency ?? "GBP", originalAmount: arr[0].originalAmount ?? null, date: arr[0].docDate })
  }

  const used = new Set<string>()
  for (const t of txns) for (const id of t.matchedDocIds) used.add(id)

  const updates: { id: string; matchedDocIds: string[] }[] = []
  for (const t of txns) {
    if (t.ignored || t.direction === "CREDIT" || t.matchedDocIds.length) continue
    const cands = units.filter((u) => {
      if (u.docIds.some((id) => used.has(id))) return false
      const gbpMatch = Math.abs(u.amount - t.amount) < 0.005
      const fxMatch = t.currency !== "GBP" && t.originalAmount != null && u.originalAmount != null && u.currency === t.currency && Math.abs(u.originalAmount - t.originalAmount) < 0.005
      return gbpMatch || fxMatch
    })
    let pick: Unit | null = null
    if (cands.length === 1) pick = cands[0]
    else if (cands.length > 1) {
      const ref = t.tranDate ?? t.postDate
      if (ref) {
        const scored = cands.map((u) => ({ u, d: u.date ? Math.abs(u.date.getTime() - ref.getTime()) : Infinity })).sort((a, b) => a.d - b.d)
        if (scored.length < 2 || scored[0].d !== scored[1].d) pick = scored[0].u
      }
    }
    if (pick) { pick.docIds.forEach((id) => used.add(id)); updates.push({ id: t.id, matchedDocIds: pick.docIds }) }
  }

  for (const u of updates) await prisma.bankTransaction.update({ where: { id: u.id }, data: { matchedDocIds: u.matchedDocIds } })
  revalidatePath(`/tools/accounts/${stmt.monthId}`)
  return { matched: updates.length, total: txns.filter((t) => !t.ignored && t.direction !== "CREDIT").length }
}

// CSV/manual import: client parses the file and sends rows (backup to the AI photo path).
export async function createBankStatementFromRows(
  monthId: string,
  label: string,
  cardholder: string,
  rows: { date?: string | null; description?: string; reference?: string; amount: number; currency?: string; originalAmount?: number | null }[],
) {
  await requireAdmin()
  const stmt = await prisma.bankStatement.create({ data: { monthId, label: (label || "Imported").slice(0, 120), cardholder: (cardholder || "").slice(0, 60), source: "CSV", images: [] } })
  const data = (rows || []).slice(0, 2000).map((r) => {
    const currency = (r.currency || "GBP").toUpperCase().slice(0, 8)
    const dt = r.date ? new Date(r.date) : null
    const amt = Number(r.amount) || 0
    return {
      statementId: stmt.id, monthId,
      postDate: dt && !isNaN(dt.getTime()) ? dt : null,
      tranDate: dt && !isNaN(dt.getTime()) ? dt : null,
      description: (r.description || "").slice(0, 300),
      reference: (r.reference || "").slice(0, 120),
      amount: r2p(Math.abs(amt)),
      currency,
      originalAmount: currency !== "GBP" && r.originalAmount ? r2p(Number(r.originalAmount)) : null,
      feeAmount: null,
      direction: amt < 0 ? "CREDIT" : "DEBIT",
    }
  })
  if (data.length) await prisma.bankTransaction.createMany({ data })
  revalidatePath(`/tools/accounts/${monthId}`)
  return { id: stmt.id, count: data.length }
}
