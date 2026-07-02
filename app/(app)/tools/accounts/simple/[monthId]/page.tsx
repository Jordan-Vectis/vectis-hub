import { redirect, notFound } from "next/navigation"
import { prisma } from "@/lib/prisma"
import { getSignedImageUrl } from "@/lib/r2"
import { DEFAULT_CARDHOLDERS } from "@/lib/accounting"
import { getAccountsAccess } from "@/lib/accounts-auth"
import SimpleWizard from "./wizard-client"

export const dynamic = "force-dynamic"

// Loads everything the guided wizard needs (same data the full month + reconcile
// pages load), signs the R2 image URLs server-side, and hands it to the client.
export default async function SimpleMonthPage({ params }: { params: Promise<{ monthId: string }> }) {
  const { monthId } = await params
  const { canAccess } = await getAccountsAccess()
  if (!canAccess) redirect("/hub")

  const month = await prisma.accountingMonth.findUnique({
    where: { id: monthId },
    include: { documents: { where: { reserved: false }, orderBy: { createdAt: "asc" } } },
  })
  if (!month) notFound()

  const chRows = await prisma.accountingCardholder.findMany({ orderBy: [{ sortOrder: "asc" }, { name: "asc" }] })
  const cardholders = chRows.length ? chRows.map((c) => c.name) : DEFAULT_CARDHOLDERS

  const documents = await Promise.all(
    month.documents.map(async (d) => {
      const keys = (d.images && d.images.length) ? d.images : (d.imageKey ? [d.imageKey] : [])
      return {
        id: d.id,
        cardholder: d.cardholder,
        source: d.source,
        images: await Promise.all(keys.map((k) => getSignedImageUrl(k))),
        supplier: d.supplier,
        item: d.item,
        website: d.website,
        docDate: d.docDate ? d.docDate.toISOString().slice(0, 10) : "",
        vatCode: d.vatCode,
        gross: d.gross,
        vat: d.vat,
        net: d.net,
        column: d.column,
        reviewed: d.reviewed,
        aiRun: d.aiRun,
        aiNotes: d.aiNotes,
        splitGroupId: d.splitGroupId,
        currency: d.currency ?? "GBP",
        originalAmount: d.originalAmount,
      }
    })
  )

  const stmtRows = await prisma.bankStatement.findMany({
    where: { monthId },
    orderBy: { createdAt: "asc" },
    include: { transactions: { orderBy: [{ tranDate: "asc" }, { createdAt: "asc" }] } },
  })
  const statements = await Promise.all(
    stmtRows.map(async (s) => ({
      id: s.id,
      label: s.label,
      cardholder: s.cardholder ?? "",
      source: s.source,
      images: await Promise.all(s.images.map((k) => getSignedImageUrl(k))),
      transactions: s.transactions.map((t) => ({
        id: t.id,
        postDate: t.postDate ? t.postDate.toISOString().slice(0, 10) : "",
        tranDate: t.tranDate ? t.tranDate.toISOString().slice(0, 10) : "",
        description: t.description ?? "",
        reference: t.reference ?? "",
        amount: t.amount,
        currency: t.currency,
        originalAmount: t.originalAmount,
        feeAmount: t.feeAmount,
        direction: t.direction,
        matchedDocIds: t.matchedDocIds,
        ignored: t.ignored,
        receiptMissing: t.receiptMissing,
      })),
    }))
  )

  return (
    <SimpleWizard
      monthId={month.id}
      monthLabel={month.label}
      documents={documents}
      statements={statements}
      cardholders={cardholders}
    />
  )
}
