import { auth } from "@/auth"
import { redirect, notFound } from "next/navigation"
import { prisma } from "@/lib/prisma"
import { getSignedImageUrl } from "@/lib/r2"
import { DEFAULT_CARDHOLDERS } from "@/lib/accounting"
import AccountsReconcile from "../reconcile-client"

export const dynamic = "force-dynamic"

export default async function ReconcilePage({ params }: { params: Promise<{ monthId: string }> }) {
  const session = await auth()
  if (!session) redirect("/login")
  if (session.user.role !== "ADMIN") redirect("/hub")

  const { monthId } = await params
  const month = await prisma.accountingMonth.findUnique({
    where: { id: monthId },
    include: { documents: { orderBy: { createdAt: "asc" } } },
  })
  if (!month) notFound()

  const chRows = await prisma.accountingCardholder.findMany({ orderBy: [{ sortOrder: "asc" }, { name: "asc" }] })
  const cardholders = chRows.length ? chRows.map((c) => c.name) : DEFAULT_CARDHOLDERS

  const entries = month.documents.map((d) => ({
    id: d.id,
    cardholder: d.cardholder ?? "",
    supplier: d.supplier ?? "",
    item: d.item ?? "",
    gross: d.gross,
    currency: d.currency ?? "GBP",
    originalAmount: d.originalAmount,
    splitGroupId: d.splitGroupId,
    docDate: d.docDate ? d.docDate.toISOString().slice(0, 10) : "",
    column: d.column ?? "",
  }))

  const stmtRows = await prisma.bankStatement.findMany({
    where: { monthId },
    orderBy: { createdAt: "asc" },
    include: { transactions: { orderBy: [{ tranDate: "asc" }, { createdAt: "asc" }] } },
  })
  const statements = await Promise.all(stmtRows.map(async (s) => ({
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
  })))

  return (
    <div className="px-6 py-8">
      <AccountsReconcile
        monthId={month.id}
        entries={entries}
        statements={statements}
        cardholders={cardholders}
        standalone
        monthLabel={month.label}
      />
    </div>
  )
}
