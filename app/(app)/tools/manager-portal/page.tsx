import { prisma } from "@/lib/prisma"
import { auth } from "@/auth"
import { redirect } from "next/navigation"
import { hasAppAccess } from "@/lib/apps"
import ManagerPortalTable, { type SaleRow } from "./manager-portal-table"

export const dynamic = "force-dynamic"

export const metadata = { title: "Manager Portal" }

export default async function ManagerPortalPage() {
  const session = await auth()
  if (!session) redirect("/login")

  const dbUser = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { role: true, allowedApps: true },
  })
  if (!hasAppAccess(dbUser?.role ?? "", dbUser?.allowedApps ?? [], "MANAGER_PORTAL")) redirect("/hub")

  const auctions = await prisma.catalogueAuction.findMany({
    orderBy: { auctionDate: "desc" },
    include: { _count: { select: { lots: true } } },
  })

  const rows: SaleRow[] = auctions.map(a => ({
    id:          a.id,
    code:        a.code,
    name:        a.name,
    auctionDate: a.auctionDate ? new Date(a.auctionDate).toISOString() : null,
    auctionType: a.auctionType,
    hubLots:     a._count.lots,
    complete:    !!a.complete,
  }))

  return (
    <div className="p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Manager Portal</h1>
        <p className="text-sm text-gray-600 dark:text-gray-400 mt-0.5">
          Lots in every sale across both systems — Hub catalogue lots and the live Business Central count, matched on sales allocation.
        </p>
      </div>

      <ManagerPortalTable rows={rows} />
    </div>
  )
}
