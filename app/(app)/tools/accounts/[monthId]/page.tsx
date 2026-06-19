import { auth } from "@/auth"
import { redirect, notFound } from "next/navigation"
import { prisma } from "@/lib/prisma"
import { getSignedImageUrl } from "@/lib/r2"
import { DEFAULT_CARDHOLDERS } from "@/lib/accounting"
import AccountsMonthClient from "./accounts-client"

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

  // Sign the scan thumbnails server-side (1h URLs).
  const documents = await Promise.all(
    month.documents.map(async (d) => ({
      id: d.id,
      cardholder: d.cardholder,
      source: d.source,
      imageUrl: d.imageKey ? await getSignedImageUrl(d.imageKey) : null,
      supplier: d.supplier,
      docDate: d.docDate ? d.docDate.toISOString().slice(0, 10) : "",
      vatCode: d.vatCode,
      gross: d.gross,
      vat: d.vat,
      net: d.net,
      column: d.column,
      reviewed: d.reviewed,
      aiNotes: d.aiNotes,
    }))
  )

  return <AccountsMonthClient monthId={month.id} monthLabel={month.label} documents={documents} cardholders={cardholders} />
}
