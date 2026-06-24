import { auth } from "@/auth"
import { redirect } from "next/navigation"
import { prisma } from "@/lib/prisma"
import { getSignedImageUrl } from "@/lib/r2"
import { DEFAULT_CARDHOLDERS } from "@/lib/accounting"
import AccountsMonthClient from "../[monthId]/accounts-client"

export const dynamic = "force-dynamic"
export const metadata = { title: "Reserves" }

// Shared reserve pool shown in the full month grid (read/edit), across all months.
export default async function ReservesPage() {
  const session = await auth()
  if (!session) redirect("/login")
  if (session.user.role !== "ADMIN") redirect("/hub")

  const docs = await prisma.accountingDocument.findMany({
    where: { reserved: true },
    orderBy: { createdAt: "asc" },
  })

  const chRows = await prisma.accountingCardholder.findMany({ orderBy: [{ sortOrder: "asc" }, { name: "asc" }] })
  const cardholders = chRows.length ? chRows.map((c) => c.name) : DEFAULT_CARDHOLDERS
  const monthRows = await prisma.accountingMonth.findMany({ orderBy: { createdAt: "desc" }, select: { id: true, label: true } })

  const documents = await Promise.all(
    docs.map(async (d) => {
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
    <AccountsMonthClient
      monthId="reserves"
      monthLabel="Reserves"
      documents={documents}
      cardholders={cardholders}
      months={monthRows}
      favourite={false}
      reserveMode
    />
  )
}
