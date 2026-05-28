import Link from "next/link"
import { prisma } from "@/lib/prisma"
import { auth } from "@/auth"
import { redirect } from "next/navigation"
import NewAuctionButton from "./new-auction-button"
import AuctionNotesButton from "./auction-notes-button"
import { getCataloguingSidebarItems } from "@/lib/apps"

export default async function AuctionsPage() {
  const session = await auth()
  if (!session) redirect("/login")
  if (!["ADMIN", "CATALOGUER"].includes(session.user.role)) redirect("/submissions")

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
  const activeAuctions = auctions.filter(a => !a.complete && !a.finished).length

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Auctions</h1>
          <p className="text-sm text-gray-600 dark:text-gray-400 mt-0.5">Manage catalogue auctions and lots</p>
        </div>
        <NewAuctionButton />
      </div>

      {/* Stats bar */}
      <div className="grid grid-cols-3 gap-4 mb-6">
        <div className="bg-white dark:bg-[#1C1C1E] rounded-xl border border-gray-300 dark:border-gray-700 p-4">
          <p className="text-xs font-medium text-gray-600 dark:text-gray-400 uppercase tracking-wide">Total Auctions</p>
          <p className="text-2xl font-bold text-gray-900 dark:text-white mt-1">{auctions.length}</p>
        </div>
        <div className="bg-white dark:bg-[#1C1C1E] rounded-xl border border-gray-300 dark:border-gray-700 p-4">
          <p className="text-xs font-medium text-gray-600 dark:text-gray-400 uppercase tracking-wide">Active</p>
          <p className="text-2xl font-bold text-gray-900 dark:text-white mt-1">{activeAuctions}</p>
        </div>
        <div className="bg-white dark:bg-[#1C1C1E] rounded-xl border border-gray-300 dark:border-gray-700 p-4">
          <p className="text-xs font-medium text-gray-600 dark:text-gray-400 uppercase tracking-wide">Total Lots</p>
          <p className="text-2xl font-bold text-gray-900 dark:text-white mt-1">{totalLots}</p>
        </div>
      </div>

      {/* Table */}
      <div className="bg-white dark:bg-[#1C1C1E] rounded-xl border border-gray-300 dark:border-gray-700 overflow-hidden">
        {auctions.length === 0 ? (
          <div className="text-center py-12 text-gray-600 dark:text-gray-500 text-sm">
            No auctions yet. Create the first one.
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 dark:border-gray-800 bg-white dark:bg-[#1C1C1E]">
                <th className="text-left px-4 py-3 font-medium text-gray-600 dark:text-gray-400">Code</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600 dark:text-gray-400">Name</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600 dark:text-gray-400">Date</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600 dark:text-gray-400">Type</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600 dark:text-gray-400">Lots</th>
                <th className="text-center px-4 py-3 font-medium text-gray-600 dark:text-gray-400">Catalogued</th>
                <th className="text-center px-4 py-3 font-medium text-gray-600 dark:text-gray-400">Added to BC</th>
                <th className="text-center px-4 py-3 font-medium text-gray-600 dark:text-gray-400">Photography</th>
                <th className="text-center px-4 py-3 font-medium text-gray-600 dark:text-gray-400">Ran through AI</th>
                <th className="text-center px-4 py-3 font-medium text-gray-600 dark:text-gray-400">Complete</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {auctions.map((auction) => (
                <tr
                  key={auction.id}
                  className="border-b border-gray-200 dark:border-gray-800 last:border-0 hover:bg-gray-100 dark:hover:bg-[#2C2C2E] transition-colors"
                >
                  <td className="px-4 py-3">
                    <Link
                      href={`/tools/cataloguing/auctions/${auction.id}`}
                      className="font-mono font-semibold text-[#2AB4A6] hover:text-[#24a090]"
                    >
                      {auction.code}
                    </Link>
                  </td>
                  <td className="px-4 py-3 font-medium text-gray-800 dark:text-gray-100">{auction.name}</td>
                  <td className="px-4 py-3 text-gray-600 dark:text-gray-400">
                    {auction.auctionDate
                      ? new Date(auction.auctionDate).toLocaleDateString("en-GB")
                      : "—"}
                  </td>
                  <td className="px-4 py-3 text-gray-600 dark:text-gray-400">{auction.auctionType}</td>
                  <td className="px-4 py-3 text-gray-600 dark:text-gray-400">{auction._count.lots}</td>
                  {(["catalogued","addedToBC","photography","aiRan","complete"] as const).map(f => (
                    <td key={f} className="px-4 py-3 text-center">
                      {(auction as any)[f]
                        ? <span className="text-green-400 font-bold">✓</span>
                        : <span className="text-gray-600">—</span>}
                    </td>
                  ))}
                  <td className="px-4 py-3 text-right">
                    {auction.notes ? <AuctionNotesButton notes={auction.notes} auctionName={auction.name} /> : <span className="text-gray-600">—</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}

