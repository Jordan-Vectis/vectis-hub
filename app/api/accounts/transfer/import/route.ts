import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"

export const maxDuration = 300

// POST /api/accounts/transfer/import — load a vectis-accounts-*.json export
// (from the other environment) into THIS environment's database. Admin only.
//
// ADD-ONLY, like the instructions import: rows keep their original ids (so
// statement→line matches survive), anything whose id already exists here is
// skipped, and nothing is ever deleted or overwritten. Safe to re-run.
// Files (the scans) are copied separately by /api/accounts/transfer/import-files.

const d = (v: unknown): Date | null => {
  if (!v || typeof v !== "string") return null
  const x = new Date(v)
  return isNaN(x.getTime()) ? null : x
}
const num = (v: unknown, fallback = 0): number => (Number.isFinite(Number(v)) ? Number(v) : fallback)
const numOrNull = (v: unknown): number | null => (v == null || !Number.isFinite(Number(v)) ? null : Number(v))
const str = (v: unknown, max = 500): string => (typeof v === "string" ? v.slice(0, max) : "")
const strOrNull = (v: unknown, max = 500): string | null => (typeof v === "string" && v ? v.slice(0, max) : null)

export async function POST(req: NextRequest) {
  try {
    const session = await auth()
    if (!session || session.user.role !== "ADMIN") {
      return NextResponse.json({ error: "Unauthorised" }, { status: 401 })
    }

    const data = await req.json()
    if (data?.kind !== "vectis-accounts-transfer" || !Array.isArray(data?.months)) {
      return NextResponse.json({ error: "Not a Vectis accounts export file" }, { status: 400 })
    }

    const created = { cardholders: 0, supplierRules: 0, months: 0, documents: 0, statements: 0, transactions: 0 }
    const skipped = { cardholders: 0, supplierRules: 0, months: 0, documents: 0, statements: 0, transactions: 0 }
    const notes: string[] = []

    // ── Cardholders (keyed by NAME, not id — entries store the name) ──
    for (const c of data.cardholders ?? []) {
      const name = str(c?.name, 60).trim()
      if (!name) continue
      const existing = await prisma.accountingCardholder.findUnique({ where: { name } })
      if (existing) { skipped.cardholders++; continue }
      await prisma.accountingCardholder.create({ data: { name, sortOrder: num(c?.sortOrder) } })
      created.cardholders++
    }

    // ── Supplier rules (learned categorisation — upsert by match) ──
    for (const r of data.supplierRules ?? []) {
      const match = str(r?.match, 200).trim()
      if (!match) continue
      const existing = await prisma.accountingSupplierRule.findUnique({ where: { match } })
      if (existing) { skipped.supplierRules++; continue }
      await prisma.accountingSupplierRule.create({
        data: { match, vatCode: num(r?.vatCode, 2), column: str(r?.column, 60) || "vectis" },
      })
      created.supplierRules++
    }

    // ── Months (preserve id; unique label conflicts get a suffix) ──
    const monthIds = new Set((await prisma.accountingMonth.findMany({ select: { id: true } })).map((m) => m.id))
    for (const m of data.months ?? []) {
      const id = str(m?.id, 40)
      if (!id) continue
      if (monthIds.has(id)) { skipped.months++; continue }
      let label = str(m?.label, 60).trim() || "Imported month"
      const clash = await prisma.accountingMonth.findUnique({ where: { label } })
      if (clash) {
        label = `${label} (imported)`.slice(0, 60)
        notes.push(`Month "${str(m?.label, 60)}" already existed here — imported as "${label}".`)
      }
      await prisma.accountingMonth.create({
        data: { id, label, favourite: m?.favourite === true, createdAt: d(m?.createdAt) ?? undefined },
      })
      monthIds.add(id)
      created.months++
    }

    // ── Documents (entered lines — preserve id, skip existing) ──
    const existingDocIds = new Set((await prisma.accountingDocument.findMany({ select: { id: true } })).map((x) => x.id))
    const docRows = []
    for (const doc of data.documents ?? []) {
      const id = str(doc?.id, 40)
      const monthId = str(doc?.monthId, 40)
      if (!id || existingDocIds.has(id)) { skipped.documents++; continue }
      if (!monthIds.has(monthId)) { skipped.documents++; notes.push(`Line ${id} skipped — its month is missing.`); continue }
      docRows.push({
        id,
        monthId,
        cardholder: str(doc?.cardholder, 60),
        source: str(doc?.source, 20) || "SCAN",
        imageKey: strOrNull(doc?.imageKey),
        images: Array.isArray(doc?.images) ? doc.images.filter((k: unknown) => typeof k === "string") : [],
        supplier: str(doc?.supplier, 200),
        item: str(doc?.item, 200),
        website: str(doc?.website, 200),
        docDate: d(doc?.docDate),
        vatCode: num(doc?.vatCode, 2),
        gross: num(doc?.gross),
        vat: num(doc?.vat),
        net: num(doc?.net),
        column: str(doc?.column, 60) || "vectis",
        reviewed: doc?.reviewed === true,
        aiRun: doc?.aiRun === true,
        aiNotes: strOrNull(doc?.aiNotes),
        splitGroupId: strOrNull(doc?.splitGroupId, 60),
        currency: str(doc?.currency, 8) || "GBP",
        originalAmount: numOrNull(doc?.originalAmount),
        cardLast4: strOrNull(doc?.cardLast4, 4),
        reserved: doc?.reserved === true,
        createdAt: d(doc?.createdAt) ?? undefined,
      })
    }
    if (docRows.length) {
      await prisma.accountingDocument.createMany({ data: docRows })
      created.documents = docRows.length
    }

    // ── Statements (preserve id, skip existing) ──
    const existingStmtIds = new Set((await prisma.bankStatement.findMany({ select: { id: true } })).map((x) => x.id))
    const stmtIds = new Set(existingStmtIds)
    for (const s of data.statements ?? []) {
      const id = str(s?.id, 40)
      const monthId = str(s?.monthId, 40)
      if (!id || existingStmtIds.has(id)) { skipped.statements++; continue }
      if (!monthIds.has(monthId)) { skipped.statements++; notes.push(`Statement ${id} skipped — its month is missing.`); continue }
      await prisma.bankStatement.create({
        data: {
          id,
          monthId,
          label: str(s?.label, 120),
          cardholder: str(s?.cardholder, 60),
          source: str(s?.source, 20) || "SCAN",
          images: Array.isArray(s?.images) ? s.images.filter((k: unknown) => typeof k === "string") : [],
          createdAt: d(s?.createdAt) ?? undefined,
        },
      })
      stmtIds.add(id)
      created.statements++
    }

    // ── Transactions (preserve id + matchedDocIds, skip existing) ──
    const existingTxnIds = new Set((await prisma.bankTransaction.findMany({ select: { id: true } })).map((x) => x.id))
    const txnRows = []
    for (const t of data.transactions ?? []) {
      const id = str(t?.id, 40)
      const statementId = str(t?.statementId, 40)
      if (!id || existingTxnIds.has(id)) { skipped.transactions++; continue }
      if (!stmtIds.has(statementId)) { skipped.transactions++; continue }
      txnRows.push({
        id,
        statementId,
        monthId: str(t?.monthId, 40),
        postDate: d(t?.postDate),
        tranDate: d(t?.tranDate),
        description: str(t?.description, 300),
        reference: str(t?.reference, 120),
        amount: num(t?.amount),
        currency: str(t?.currency, 8) || "GBP",
        originalAmount: numOrNull(t?.originalAmount),
        feeAmount: numOrNull(t?.feeAmount),
        direction: str(t?.direction, 10) || "DEBIT",
        matchedDocIds: Array.isArray(t?.matchedDocIds) ? t.matchedDocIds.filter((x: unknown) => typeof x === "string") : [],
        ignored: t?.ignored === true,
        receiptMissing: t?.receiptMissing === true,
        createdAt: d(t?.createdAt) ?? undefined,
      })
    }
    if (txnRows.length) {
      await prisma.bankTransaction.createMany({ data: txnRows })
      created.transactions = txnRows.length
    }

    return NextResponse.json({ ok: true, created, skipped, notes })
  } catch (e: any) {
    console.error("accounts/transfer/import error:", e)
    return NextResponse.json({ error: e?.message ?? "Unknown error" }, { status: 500 })
  }
}
