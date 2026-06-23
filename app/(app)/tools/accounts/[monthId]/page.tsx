import { auth } from "@/auth"
import { redirect, notFound } from "next/navigation"
import { prisma } from "@/lib/prisma"
import { getSignedImageUrl } from "@/lib/r2"
import { DEFAULT_CARDHOLDERS } from "@/lib/accounting"
import AccountsMonthClient from "./accounts-client"
import Link from "next/link"

export const dynamic = "force-dynamic"

export default async function AccountsMonthPage({ params }: { params: Promise<{ monthId: string }> }) {
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

  // Sign every page's URL server-side (1h URLs).
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

  return (
    <>
      <AccountsMonthClient monthId={month.id} monthLabel={month.label} documents={documents} cardholders={cardholders} />
      <div className="px-6 pb-10 -mt-2">
        <Link href={`/tools/accounts/${month.id}/reconcile`} className="inline-flex items-center gap-2 text-sm font-semibold px-4 py-2 rounded-lg border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:border-emerald-500 hover:text-emerald-600 dark:hover:text-emerald-400">
          🏦 Reconcile against bank statement →
        </Link>
      </div>
    </>
  )
}
