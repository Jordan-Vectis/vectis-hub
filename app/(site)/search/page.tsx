import { prisma } from "@/lib/prisma"
import { notFound } from "next/navigation"
import Link from "next/link"
import Image from "next/image"
import { lotPhotoUrl } from "@/lib/photo-url"
import type { Metadata } from "next"

export const dynamic = "force-dynamic"

export async function generateMetadata({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; filter?: string }>
}): Promise<Metadata> {
  const { q } = await searchParams
  return {
    title: q ? `Search results for "${q}" — Vectis` : "Search — Vectis",
  }
}

function isPast(auctionDate: Date | null, finished: boolean, complete: boolean): boolean {
  if (finished || complete) return true
  if (!auctionDate) return false
  return new Date(auctionDate.getTime() + 24 * 60 * 60 * 1000) < new Date()
}

const PAGE_SIZE = 48

export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; filter?: string; page?: string }>
}) {
  const { q, filter, page } = await searchParams
  const query = (q ?? "").trim()
  const currentPage = Math.max(1, parseInt(page ?? "1", 10))

  if (!query) {
    return (
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-20 text-center">
        <p className="text-gray-400 text-lg">Enter a search term to find lots.</p>
      </div>
    )
  }

  // Get all published auctions with their lots matching the query
  const allPublished = await prisma.catalogueAuction.findMany({
    where: { published: true },
    select: {
      id: true,
      code: true,
      name: true,
      auctionDate: true,
      finished: true,
      complete: true,
      lots: {
        where: {
          OR: [
            { title: { contains: query, mode: "insensitive" } },
            { description: { contains: query, mode: "insensitive" } },
            { barcode: { contains: query, mode: "insensitive" } },
            { brand: { contains: query, mode: "insensitive" } },
            { category: { contains: query, mode: "insensitive" } },
          ],
        },
        select: {
          id: true,
          barcode: true,
          receiptUniqueId: true,
          title: true,
          estimateLow: true,
          estimateHigh: true,
          hammerPrice: true,
          condition: true,
          imageUrls: true,
          status: true,
        },
      },
    },
  })

  // Apply upcoming/past filter
  const filterVal = filter ?? "all"
  const filtered = allPublished.filter(a => {
    const past = isPast(a.auctionDate, a.finished, a.complete)
    if (filterVal === "upcoming") return !past
    if (filterVal === "past") return past
    return true
  })

  // Flatten lots with their auction info
  type LotResult = {
    id: string
    barcode: string | null
    receiptUniqueId: string | null
    title: string
    estimateLow: number | null
    estimateHigh: number | null
    hammerPrice: number | null
    condition: string | null
    imageUrls: string[]
    status: string
    auctionCode: string
    auctionName: string
    auctionDate: Date | null
    isPast: boolean
  }

  const allLots: LotResult[] = filtered.flatMap(a =>
    a.lots.map(l => ({
      ...l,
      auctionCode: a.code,
      auctionName: a.name,
      auctionDate: a.auctionDate,
      isPast: isPast(a.auctionDate, a.finished, a.complete),
    }))
  )

  const totalResults = allLots.length
  const totalPages = Math.ceil(totalResults / PAGE_SIZE)
  const pageLots = allLots.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE)

  function buildUrl(p: number) {
    const params = new URLSearchParams()
    params.set("q", query)
    if (filterVal !== "all") params.set("filter", filterVal)
    if (p > 1) params.set("page", String(p))
    return `/search?${params.toString()}`
  }

  return (
    <div>
      {/* ── Results header ── */}
      <div className="bg-white border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <h1 className="text-2xl font-black text-[#32348A] uppercase tracking-tight">
                Search Results
              </h1>
              <p className="text-sm text-gray-500 mt-1">
                <span className="font-semibold text-gray-700">{totalResults.toLocaleString()}</span>{" "}
                {totalResults === 1 ? "lot" : "lots"} found for{" "}
                <span className="font-semibold text-[#32348A]">&ldquo;{query}&rdquo;</span>
                {filterVal !== "all" && (
                  <> in <span className="font-semibold">{filterVal === "upcoming" ? "upcoming" : "past"} auctions</span></>
                )}
              </p>
            </div>

            {/* Filter tabs */}
            <div className="flex gap-1">
              {(["all", "upcoming", "past"] as const).map(f => (
                <Link
                  key={f}
                  href={`/search?q=${encodeURIComponent(query)}&filter=${f}`}
                  className={`px-4 py-2 text-xs font-bold uppercase tracking-wider border transition-colors ${
                    filterVal === f
                      ? "bg-[#32348A] text-white border-[#32348A]"
                      : "bg-white text-gray-500 border-gray-300 hover:border-[#32348A] hover:text-[#32348A]"
                  }`}
                >
                  {f === "all" ? "All" : f === "upcoming" ? "Upcoming" : "Past Results"}
                </Link>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* ── Results grid ── */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-8">
        {pageLots.length === 0 ? (
          <div className="text-center py-20">
            <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <svg className="w-8 h-8 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21 21l-4.35-4.35M17 11A6 6 0 1 1 5 11a6 6 0 0 1 12 0z" />
              </svg>
            </div>
            <p className="text-gray-500 font-semibold text-lg mb-2">No lots found</p>
            <p className="text-gray-400 text-sm">Try a different search term or change the filter.</p>
            <Link href="/auctions" className="mt-6 inline-block bg-[#32348A] text-white text-xs font-black uppercase tracking-widest px-6 py-3 hover:bg-[#28296e] transition-colors">
              Browse All Auctions
            </Link>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-0 border-l border-t border-gray-200">
              {pageLots.map(lot => (
                <SearchLotCard key={lot.id} lot={lot} />
              ))}
            </div>

            {/* Pagination */}
            {totalPages > 1 && (
              <div className="flex items-center justify-center gap-2 mt-10 flex-wrap">
                {currentPage > 1 && (
                  <Link href={buildUrl(currentPage - 1)} className="px-3 py-2 text-sm font-semibold border border-gray-300 bg-white text-[#32348A] hover:border-[#32348A] transition-colors">
                    ← Prev
                  </Link>
                )}
                {Array.from({ length: totalPages }, (_, i) => i + 1)
                  .filter(p => Math.abs(p - currentPage) <= 2)
                  .map(p => (
                    <Link
                      key={p}
                      href={buildUrl(p)}
                      className={`min-w-[2.5rem] text-center px-3 py-2 text-sm font-semibold border transition-colors ${
                        p === currentPage
                          ? "bg-[#32348A] text-white border-[#32348A]"
                          : "bg-white text-[#32348A] border-gray-300 hover:border-[#32348A]"
                      }`}
                    >
                      {p}
                    </Link>
                  ))}
                {currentPage < totalPages && (
                  <Link href={buildUrl(currentPage + 1)} className="px-3 py-2 text-sm font-semibold border border-gray-300 bg-white text-[#32348A] hover:border-[#32348A] transition-colors">
                    Next →
                  </Link>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}

function SearchLotCard({ lot }: {
  lot: {
    id: string
    barcode: string | null
    receiptUniqueId: string | null
    title: string
    estimateLow: number | null
    estimateHigh: number | null
    hammerPrice: number | null
    condition: string | null
    imageUrls: string[]
    status: string
    auctionCode: string
    auctionName: string
    auctionDate: Date | null
    isPast: boolean
  }
}) {
  const img = lotPhotoUrl(lot.imageUrls[0], true)
  const sold = lot.status === "SOLD"
  const lotLabel = lot.barcode ?? lot.receiptUniqueId ?? "—"

  return (
    <Link
      href={`/auctions/${lot.auctionCode}#lot-${lot.id}`}
      className="group border-r border-b border-gray-200 bg-white hover:bg-gray-50 transition-colors flex flex-col cursor-pointer"
    >
      {/* Image */}
      <div className="relative bg-gray-100 aspect-square overflow-hidden">
        {img ? (
          <Image
            src={img}
            alt={lot.title}
            fill
            className="object-cover group-hover:scale-105 transition-transform duration-300"
            sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 16vw"
          />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center text-gray-200">
            <svg className="w-10 h-10" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
          </div>
        )}
        <div className="absolute top-0 left-0 bg-[#32348A] text-white text-[10px] font-bold px-2 py-0.5 tracking-wider">
          LOT {lotLabel}
        </div>
        {sold && (
          <div className="absolute inset-0 bg-black/50 flex items-center justify-center">
            <span className="text-white font-black text-sm tracking-widest uppercase">SOLD</span>
          </div>
        )}
        {/* Auction name badge */}
        <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/70 to-transparent px-2 py-1.5">
          <p className="text-white text-[9px] font-semibold truncate">{lot.auctionName}</p>
        </div>
      </div>

      {/* Details */}
      <div className="p-2.5 flex flex-col flex-1">
        <p className="text-xs font-medium text-gray-800 leading-snug line-clamp-2 mb-1.5 group-hover:text-[#32348A]">
          {lot.title}
        </p>
        {lot.condition && (
          <p className="text-[10px] text-gray-400 mb-1">{lot.condition}</p>
        )}
        <div className="mt-auto">
          {sold && lot.hammerPrice ? (
            <div>
              <p className="text-[10px] text-gray-400">Sold</p>
              <p className="text-sm font-black text-[#32348A]">£{lot.hammerPrice.toLocaleString("en-GB")}</p>
            </div>
          ) : (lot.estimateLow || lot.estimateHigh) ? (
            <div>
              <p className="text-[10px] text-gray-400">Estimate</p>
              <p className="text-xs font-bold text-gray-700">
                {lot.estimateLow && lot.estimateHigh
                  ? `£${lot.estimateLow.toLocaleString("en-GB")} – £${lot.estimateHigh.toLocaleString("en-GB")}`
                  : lot.estimateLow
                  ? `£${lot.estimateLow.toLocaleString("en-GB")}+`
                  : `–£${lot.estimateHigh!.toLocaleString("en-GB")}`}
              </p>
            </div>
          ) : (
            <p className="text-[10px] text-gray-300">Estimate TBC</p>
          )}
        </div>
      </div>
    </Link>
  )
}
