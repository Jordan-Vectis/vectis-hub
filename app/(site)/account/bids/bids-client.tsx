"use client"

import { useState } from "react"
import Link from "next/link"
import Image from "next/image"
import { format } from "date-fns"
import { lotPhotoUrl } from "@/lib/photo-url"

type LotBid = {
  bidId: string
  lotId: string
  lotBarcode: string | null
  lotTitle: string
  imageUrl: string | null
  lotStatus: string
  currentBid: number | null
  hammerPrice: number | null
  estimateLow: number | null
  estimateHigh: number | null
  maxBid: number
  placedAt: string
  updatedAt: string
}

type AuctionGroup = {
  auctionId: string
  auctionCode: string
  auctionName: string
  auctionDate: string | null
  isFinished: boolean
  bids: LotBid[]
}

interface Props {
  groups: AuctionGroup[]
}

export default function BidsClient({ groups }: Props) {
  // Start with the first (most-recent) group open, rest closed
  const [open, setOpen] = useState<Set<string>>(
    () => new Set(groups.length > 0 ? [groups[0].auctionId] : [])
  )

  function toggle(id: string) {
    setOpen(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  if (groups.length === 0) {
    return (
      <div className="bg-white border border-gray-200 p-8 text-center mb-6">
        <div className="w-16 h-16 bg-[#32348A]/5 flex items-center justify-center mx-auto mb-4">
          <svg className="w-8 h-8 text-[#32348A]/30" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
          </svg>
        </div>
        <p className="text-gray-700 font-semibold text-lg mb-2">No bids placed yet</p>
        <p className="text-sm text-gray-400 max-w-md mx-auto mb-6">
          Browse our upcoming auctions and place commission bids on the lots you want.
        </p>
        <Link
          href="/auctions"
          className="inline-block bg-[#32348A] hover:bg-[#28296e] text-white text-xs font-black uppercase tracking-widest px-6 py-3 transition-colors"
        >
          Browse Auctions
        </Link>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-3 mb-6">
      {groups.map(group => {
        const isOpen = open.has(group.auctionId)
        const totalBid = group.bids.reduce((s, b) => s + b.maxBid, 0)
        const wonCount = group.bids.filter(b => b.lotStatus === "SOLD" && b.hammerPrice !== null).length
        const activeBids = group.bids.filter(b => b.lotStatus !== "SOLD").length

        return (
          <div key={group.auctionId} className="border border-gray-200 bg-white overflow-hidden">
            {/* Auction header — click to collapse */}
            <button
              onClick={() => toggle(group.auctionId)}
              className="w-full flex items-center justify-between px-5 py-4 hover:bg-gray-50 transition-colors text-left"
            >
              <div className="flex items-center gap-4 min-w-0">
                {/* Chevron */}
                <svg
                  className={`w-4 h-4 shrink-0 text-gray-400 transition-transform duration-200 ${isOpen ? "rotate-90" : ""}`}
                  fill="none" stroke="currentColor" viewBox="0 0 24 24"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 5l7 7-7 7" />
                </svg>

                <div className="min-w-0">
                  <p className="font-black text-[#32348A] text-sm leading-tight truncate">{group.auctionName}</p>
                  <p className="text-xs text-gray-400 mt-0.5">
                    {group.auctionDate
                      ? format(new Date(group.auctionDate), "d MMMM yyyy")
                      : "Date TBC"}
                    {" · "}{group.bids.length} {group.bids.length === 1 ? "lot" : "lots"}
                  </p>
                </div>
              </div>

              {/* Right-side summary */}
              <div className="flex items-center gap-4 shrink-0 ml-4">
                {wonCount > 0 && (
                  <span className="text-[10px] font-black uppercase tracking-widest text-green-700 bg-green-50 border border-green-200 px-2 py-0.5">
                    {wonCount} WON
                  </span>
                )}
                {activeBids > 0 && !group.isFinished && (
                  <span className="text-[10px] font-black uppercase tracking-widest text-[#2AB4A6] bg-[#2AB4A6]/10 border border-[#2AB4A6]/30 px-2 py-0.5">
                    {activeBids} ACTIVE
                  </span>
                )}
                {group.isFinished && wonCount === 0 && (
                  <span className="text-[10px] font-black uppercase tracking-widest text-gray-400 bg-gray-100 border border-gray-200 px-2 py-0.5">
                    ENDED
                  </span>
                )}
                <div className="text-right hidden sm:block">
                  <p className="text-[10px] text-gray-400 font-semibold uppercase tracking-wider">Total Bid</p>
                  <p className="text-sm font-black text-[#32348A]">£{totalBid.toLocaleString("en-GB")}</p>
                </div>
              </div>
            </button>

            {/* Collapsible lot rows */}
            {isOpen && (
              <div className="border-t border-gray-200">
                {group.bids.map(bid => {
                  const img = bid.imageUrl ? lotPhotoUrl(bid.imageUrl, true) : null
                  const sold = bid.lotStatus === "SOLD"
                  const won = sold && bid.hammerPrice !== null

                  return (
                    <div
                      key={bid.bidId}
                      className="flex items-stretch border-b border-gray-100 last:border-b-0 hover:bg-gray-50 transition-colors"
                    >
                      {/* Thumbnail */}
                      <Link
                        href={`/auctions/${group.auctionCode}/lot/${bid.lotId}`}
                        className="relative shrink-0 bg-gray-100 overflow-hidden"
                        style={{ width: "72px", minHeight: "72px" }}
                      >
                        {img ? (
                          <Image src={img} alt={bid.lotTitle} fill className="object-cover" sizes="72px" />
                        ) : (
                          <div className="absolute inset-0 flex items-center justify-center">
                            <svg className="w-5 h-5 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                            </svg>
                          </div>
                        )}
                      </Link>

                      {/* Lot info */}
                      <div className="flex-1 px-4 py-3 flex flex-col justify-center min-w-0">
                        <Link href={`/auctions/${group.auctionCode}/lot/${bid.lotId}`} className="hover:underline">
                          <p className="text-sm font-bold text-[#32348A] truncate">{bid.lotTitle}</p>
                        </Link>
                        <p className="text-xs text-gray-400 mt-0.5">
                          {bid.lotBarcode ? `Lot ${bid.lotBarcode}` : "—"}
                          {bid.estimateLow && bid.estimateHigh && (
                            <> · Est. £{bid.estimateLow.toLocaleString("en-GB")}–£{bid.estimateHigh.toLocaleString("en-GB")}</>
                          )}
                        </p>
                        <p className="text-[10px] text-gray-300 mt-0.5">
                          Bid placed {format(new Date(bid.placedAt), "d MMM yyyy HH:mm")}
                          {bid.updatedAt !== bid.placedAt && (
                            <> · Updated {format(new Date(bid.updatedAt), "d MMM HH:mm")}</>
                          )}
                        </p>
                      </div>

                      {/* Bid figures */}
                      <div className="shrink-0 border-l border-gray-100 flex items-center">
                        {/* Current bid — only show when a bid has been placed on the lot */}
                        {bid.currentBid && bid.currentBid > 0 && !won ? (
                          <div className="px-4 py-3 flex flex-col items-end justify-center border-r border-gray-100 min-w-[100px]">
                            <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">Current Bid</p>
                            <p className={`text-base font-black ${bid.currentBid >= bid.maxBid ? "text-[#DB0606]" : "text-gray-700"}`}>
                              £{bid.currentBid.toLocaleString("en-GB")}
                            </p>
                            {bid.currentBid >= bid.maxBid && (
                              <p className="text-[9px] text-[#DB0606] font-bold uppercase tracking-wider mt-0.5">At limit</p>
                            )}
                          </div>
                        ) : null}

                        {/* Max / hammer */}
                        <div className="px-4 py-3 flex flex-col items-end justify-center min-w-[90px]">
                          {won ? (
                            <>
                              <p className="text-[10px] font-semibold uppercase tracking-wider text-green-600">Hammer</p>
                              <p className="text-base font-black text-green-700">£{bid.hammerPrice!.toLocaleString("en-GB")}</p>
                            </>
                          ) : (
                            <>
                              <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">Max Bid</p>
                              <p className="text-base font-black text-[#32348A]">£{bid.maxBid.toLocaleString("en-GB")}</p>
                            </>
                          )}
                        </div>
                      </div>

                      {/* Status */}
                      <div className="shrink-0 w-24 border-l border-gray-100 flex items-center justify-center px-2">
                        {won ? (
                          <span className="text-[10px] font-black uppercase tracking-widest text-green-700 bg-green-50 border border-green-200 px-2 py-0.5">WON</span>
                        ) : sold ? (
                          <span className="text-[10px] font-black uppercase tracking-widest text-red-500 bg-red-50 border border-red-200 px-2 py-0.5">NOT WON</span>
                        ) : group.isFinished ? (
                          <span className="text-[10px] font-black uppercase tracking-widest text-gray-400 bg-gray-100 border border-gray-200 px-2 py-0.5">ENDED</span>
                        ) : (
                          <span className="text-[10px] font-black uppercase tracking-widest text-[#2AB4A6] bg-[#2AB4A6]/10 border border-[#2AB4A6]/30 px-2 py-0.5">ACTIVE</span>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
