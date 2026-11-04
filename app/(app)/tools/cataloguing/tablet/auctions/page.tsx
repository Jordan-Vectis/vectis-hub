import Link from "next/link"
import { prisma } from "@/lib/prisma"
import { auth } from "@/auth"
import { redirect } from "next/navigation"
import { auctionTypeEmoji } from "@/lib/auction-types"
import { getDepartmentAccessForSession, auctionWhere } from "@/lib/departments"
import FavouriteStar from "./favourite-star"

export default async function TabletAuctionsPage() {
  const session = await auth()
  if (!session) redirect("/login")
  // Access is enforced by the cataloguing layout (hasAppAccess "CATALOGUING") — no hard-coded role gate here (it was bouncing managers/other granted roles to /submissions).

  // Same department filter as the desktop list — the tablet must not be a way round it.
  const access = await getDepartmentAccessForSession(session.user.id)

  const auctions = await prisma.catalogueAuction.findMany({
    where:   auctionWhere(access),
    orderBy: { auctionDate: "desc" },
    include: { _count: { select: { lots: true } } },
  })

  // The sales THIS person has starred — the same per-person table as the desktop Auction Manager.
  // Migration-safe: an empty set until the table exists.
  let favourites = new Set<string>()
  try {
    const rows = await prisma.catalogueAuctionFavourite.findMany({
      where:  { userId: session.user.id },
      select: { auctionId: true },
    })
    favourites = new Set(rows.map(r => r.auctionId))
  } catch { /* not migrated yet */ }

  // Starred sales are lifted out of their section and pinned to the top, completed ones included.
  const pinned   = auctions.filter(a => favourites.has(a.id))
  const active   = auctions.filter(a => !favourites.has(a.id) && !a.complete && !a.finished)
  const archived = auctions.filter(a => !favourites.has(a.id) && (a.complete || a.finished))

  function badge(a: typeof auctions[number]) {
    // Light-first with dark: variants, like the tablet screen it opens (light/dark switch, 2026-09-11).
    if (a.complete)  return { label: "Complete",  cls: "bg-green-100 text-green-700 dark:bg-green-900/50 dark:text-green-300" }
    if (a.finished)  return { label: "Finished",  cls: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/50 dark:text-yellow-300" }
    if (a.locked)    return { label: "Locked",    cls: "bg-blue-100 text-blue-700 dark:bg-blue-900/50 dark:text-blue-300" }
    return null
  }

  function AuctionCard({ a }: { a: typeof auctions[number] }) {
    const b = badge(a)
    return (
      <div className="relative">
      <Link
        href={`/tools/cataloguing/tablet/auctions/${a.id}`}
        className="block pr-16 bg-white dark:bg-[#1C1C1E] border border-gray-300 dark:border-gray-700 rounded-2xl p-6 active:scale-[0.98] transition-transform"
      >
        <div className="flex items-start justify-between gap-3 mb-2">
          <span className="font-mono font-bold text-[#2AB4A6] text-2xl leading-none">{a.code}</span>
          {b && (
            <span className={`text-sm px-3 py-1 rounded-full font-medium ${b.cls}`}>{b.label}</span>
          )}
        </div>
        <p className="text-gray-900 dark:text-white font-semibold text-lg mb-3 leading-snug">{a.name}</p>
        <div className="flex items-center gap-4 text-base text-gray-600 dark:text-gray-400">
          <span>🏷 {a._count.lots} lot{a._count.lots !== 1 ? "s" : ""}</span>
          {a.auctionDate && (
            <span>📅 {new Date(a.auctionDate).toLocaleDateString("en-GB")}</span>
          )}
          <span className="text-gray-600">{auctionTypeEmoji(a.auctionType)} {a.auctionType}</span>
        </div>
      </Link>
      {/* Beside the link, never inside it — a button in a link would open the sale too. */}
      <div className="absolute top-3 right-3">
        <FavouriteStar auctionId={a.id} initial={favourites.has(a.id)} />
      </div>
      </div>
    )
  }

  return (
    <div className="p-5 max-w-2xl mx-auto">
      {/* Header */}
      <div className="mb-7">
        <h1 className="text-3xl font-bold text-gray-900 dark:text-white">Tablet Cataloguing</h1>
        <p className="text-base text-gray-600 dark:text-gray-400 mt-1">Select an auction to catalogue lots</p>
      </div>

      {auctions.length === 0 ? (
        <div className="text-center py-16 text-gray-500 text-sm">
          No auctions yet.
        </div>
      ) : (
        <div className="space-y-6">
          {/* ★ Currently working on — only ever visible to the person who starred them */}
          {pinned.length > 0 && (
            <section>
              <p className="text-sm font-semibold uppercase tracking-widest text-amber-600 dark:text-amber-400 mb-3 px-1">
                ★ Currently working on <span className="normal-case tracking-normal font-normal text-gray-500">· only you see these</span>
              </p>
              <div className="space-y-3">
                {pinned.map(a => <AuctionCard key={a.id} a={a} />)}
              </div>
            </section>
          )}

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
