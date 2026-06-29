import { prisma } from "@/lib/prisma"
import { auth } from "@/auth"
import { redirect } from "next/navigation"
import NewAuctionButton from "./new-auction-button"
import ExportImportButtons from "./export-import-buttons"
import AuctionsTables, { type AuctionRow } from "./auctions-tables"
import { getCataloguingSidebarItems } from "@/lib/apps"

export default async function AuctionsPage() {
  const session = await auth()
  if (!session) redirect("/login")
  // Access is enforced by the cataloguing layout (hasAppAccess "CATALOGUING") — no hard-coded role gate here (it was bouncing managers/other granted roles to /submissions).

  const dbUser = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { role: true, appPermissions: true },
  })
  const allowed = getCataloguingSidebarItems(dbUser?.role ?? "", dbUser?.appPermissions as any)
  if (!allowed.includes("AUCTION_MANAGER")) redirect("/tools/cataloguing/tablet/auctions")

  const auctions = await prisma.catalogueAuction.findMany({
    orderBy: { auctionDate: "desc" },
    include: { _count: { select: { lots: true } } },
  })

  const totalLots = auctions.reduce((sum, a) => sum + a._count.lots, 0)

  const rows: AuctionRow[] = auctions.map(a => ({
    id: a.id,
    code: a.code,
    name: a.name,
    auctionDate: a.auctionDate ? new Date(a.auctionDate).toISOString() : null,
    auctionType: a.auctionType,
    lots: a._count.lots,
    catalogued: !!(a as any).catalogued,
    addedToBC: !!(a as any).addedToBC,
    photography: !!(a as any).photography,
    aiRan: !!(a as any).aiRan,
    complete: !!a.complete,
    notes: a.notes ?? null,
  }))
  const active    = rows.filter(r => !r.complete)
  const completed = rows.filter(r => r.complete)

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Auctions</h1>
          <p className="text-sm text-gray-600 dark:text-gray-400 mt-0.5">Manage catalogue auctions and lots</p>
        </div>
        <div className="flex items-center gap-2">
          <ExportImportButtons auctions={auctions.map(a => ({ id: a.id, code: a.code, name: a.name }))} />
          <NewAuctionButton />
        </div>
      </div>

      {/* Stats bar */}
      <div className="grid grid-cols-3 gap-4 mb-6">
        <div className="bg-white dark:bg-[#1C1C1E] rounded-xl border border-gray-300 dark:border-gray-700 p-4">
          <p className="text-xs font-medium text-gray-600 dark:text-gray-400 uppercase tracking-wide">Total Auctions</p>
          <p className="text-2xl font-bold text-gray-900 dark:text-white mt-1">{auctions.length}</p>
        </div>
        <div className="bg-white dark:bg-[#1C1C1E] rounded-xl border border-gray-300 dark:border-gray-700 p-4">
          <p className="text-xs font-medium text-gray-600 dark:text-gray-400 uppercase tracking-wide">Active</p>
          <p className="text-2xl font-bold text-gray-900 dark:text-white mt-1">{active.length}</p>
        </div>
        <div className="bg-white dark:bg-[#1C1C1E] rounded-xl border border-gray-300 dark:border-gray-700 p-4">
          <p className="text-xs font-medium text-gray-600 dark:text-gray-400 uppercase tracking-wide">Total Lots</p>
          <p className="text-2xl font-bold text-gray-900 dark:text-white mt-1">{totalLots}</p>
        </div>
      </div>

      <AuctionsTables active={active} completed={completed} />
    </div>
  )
}

