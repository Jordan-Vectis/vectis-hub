import Link from "next/link"
import { prisma } from "@/lib/prisma"
import { auth } from "@/auth"
import { redirect } from "next/navigation"

export default async function TabletAuctionsPage() {
  const session = await auth()
  if (!session) redirect("/login")
  // Access is enforced by the cataloguing layout (hasAppAccess "CATALOGUING") — no hard-coded role gate here (it was bouncing managers/other granted roles to /submissions).

  const auctions = await prisma.catalogueAuction.findMany({
    orderBy: { auctionDate: "desc" },
    include: { _count: { select: { lots: true } } },
  })

  const active   = auctions.filter(a => !a.complete && !a.finished)
  const archived = auctions.filter(a => a.complete || a.finished)

  function badge(a: typeof auctions[number]) {
    if (a.complete)  return { label: "Complete",  cls: "bg-green-900/50 text-green-300" }
    if (a.finished)  return { label: "Finished",  cls: "bg-yellow-900/50 text-yellow-300" }
    if (a.locked)    return { label: "Locked",    cls: "bg-blue-900/50 text-blue-300" }
    return null
  }

  function AuctionCard({ a }: { a: typeof auctions[number] }) {
    const b = badge(a)
    return (
      <Link
        href={`/tools/cataloguing/tablet/auctions/${a.id}`}
        className="block bg-[#1C1C1E] border border-gray-700 rounded-2xl p-6 active:scale-[0.98] transition-transform"
      >
        <div className="flex items-start justify-between gap-3 mb-2">
          <span className="font-mono font-bold text-[#2AB4A6] text-2xl leading-none">{a.code}</span>
          {b && (
            <span className={`text-sm px-3 py-1 rounded-full font-medium ${b.cls}`}>{b.label}</span>
          )}
        </div>
        <p className="text-white font-semibold text-lg mb-3 leading-snug">{a.name}</p>
        <div className="flex items-center gap-4 text-base text-gray-400">
          <span>🏷 {a._count.lots} lot{a._count.lots !== 1 ? "s" : ""}</span>
          {a.auctionDate && (
            <span>📅 {new Date(a.auctionDate).toLocaleDateString("en-GB")}</span>
          )}
          <span className="text-gray-600">{a.auctionType}</span>
        </div>
      </Link>
    )
  }

  return (
    <div className="p-5 max-w-2xl mx-auto">
      {/* Header */}
      <div className="mb-7">
        <h1 className="text-3xl font-bold text-white">Tablet Cataloguing</h1>
        <p className="text-base text-gray-400 mt-1">Select an auction to catalogue lots</p>
      </div>

      {auctions.length === 0 ? (
        <div className="text-center py-16 text-gray-500 text-sm">
          No auctions yet.
        </div>
      ) : (
        <div className="space-y-6">
          {/* Active auctions */}
          {active.length > 0 && (
            <section>
              <p className="text-sm font-semibold uppercase tracking-widest text-gray-500 mb-3 px-1">Active</p>
              <div className="space-y-3">
                {active.map(a => <AuctionCard key={a.id} a={a} />)}
              </div>
            </section>
          )}

          {/* Archived auctions */}
          {archived.length > 0 && (
            <section>
              <p className="text-sm font-semibold uppercase tracking-widest text-gray-500 mb-3 px-1">Archived</p>
              <div className="space-y-3">
                {archived.map(a => <AuctionCard key={a.id} a={a} />)}
              </div>
            </section>
          )}
        </div>
      )}
    </div>
  )
}
