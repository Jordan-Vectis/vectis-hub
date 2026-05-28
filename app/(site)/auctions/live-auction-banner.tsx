"use client"

import { useEffect, useState } from "react"
import { io as ioClient } from "socket.io-client"
import Image from "next/image"
import Link from "next/link"
import { lotPhotoUrl } from "@/lib/photo-url"
import { format } from "date-fns"

interface LotInfo {
  id: string
  barcode: string
  title: string
  imageUrls: string[]
  estimateLow: number | null
  estimateHigh: number | null
}

interface LiveLot {
  id: string
  barcode: string
  title: string
  description: string
  imageUrls: string[]
  estimateLow: number | null
  estimateHigh: number | null
  status: string
  currentBid: number
  askingBid: number
  hammerPrice: number | null
  bids: { amount: number; type: string; bidderName?: string; timestamp: string }[]
}

interface AuctionState {
  auction: {
    title: string
    status: string
    currentLotIndex: number
    fairWarning: boolean
    totalLots: number
  } | null
  currentLot: LiveLot | null
  lots: { id: string; barcode: string; status: string; hammerPrice: number | null }[]
  onlineCount: number
}

interface Props {
  auctionId: string
  auctionName: string
  auctionCode: string
  auctionDate: Date | null
  currentLotIndex: number
  status: string
  lots: LotInfo[]
}

function fmt(n: number | null | undefined) {
  if (!n && n !== 0) return "—"
  return `£${n.toLocaleString()}`
}

export default function LiveAuctionBanner({
  auctionName, auctionCode, auctionDate, lots: initialLots,
}: Props) {
  const [state, setState] = useState<AuctionState | null>(null)
  const [fairWarning, setFairWarning] = useState(false)
  const [connected, setConnected] = useState(false)
  const [bidFlash, setBidFlash] = useState(false)

  useEffect(() => {
    const socket = ioClient(window.location.origin, { transports: ["websocket", "polling"] })
    socket.on("connect", () => { setConnected(true); socket.emit("bidder:join", { name: "Guest" }) })
    socket.on("disconnect", () => setConnected(false))
    socket.on("auction:state", (s: AuctionState) => { setState(s); setFairWarning(s.auction?.fairWarning ?? false) })
    socket.on("bid:new", () => { setBidFlash(true); setTimeout(() => setBidFlash(false), 800) })
    socket.on("auction:fairWarning", () => setFairWarning(true))
    return () => { socket.disconnect() }
  }, [])

  const lot = state?.currentLot
  const auction = state?.auction
  const fallbackLot = initialLots[0] ?? null

  const rawImg = lot?.imageUrls?.[0] ?? fallbackLot?.imageUrls[0] ?? null
  const displayImg = lotPhotoUrl(rawImg, true)

  const lotsSold = state?.lots.filter(l => l.status === "SOLD").length ?? 0
  const totalLots = auction?.totalLots ?? initialLots.length

  const lastBid = lot?.bids?.[lot.bids.length - 1]
  const lastBidderName = lastBid?.bidderName ?? (lastBid ? lastBid.type : null)

  return (
    <div className="bg-white border-b border-gray-200">

      {/* ── Announcement bar ── */}
      <div className="bg-[#555] text-white text-center text-xs py-2 px-4 font-medium">
        {connected
          ? `🔴 Live Auction in progress — ${lotsSold} of ${totalLots} lots sold · ${state?.onlineCount ?? 0} watching`
          : "Connecting to live auction…"}
      </div>

      {/* ── Main split layout ── */}
      <div className="flex" style={{ minHeight: "560px" }}>

        {/* LEFT — big lot image with overlay */}
        <div className="relative flex-1 bg-[#32348A] overflow-hidden">
          {displayImg ? (
            <Image
              src={displayImg}
              alt={lot?.title ?? auctionName}
              fill
              className="object-cover"
              priority
             
            />
          ) : (
            <div className="absolute inset-0 bg-gradient-to-br from-[#32348A] to-[#4446a8]" />
          )}

          {/* Fair warning overlay */}
          {fairWarning && (
            <div className="absolute inset-0 bg-amber-500/20 animate-pulse z-10 pointer-events-none" />
          )}

          {/* Bottom-left info card */}
          <div className="absolute bottom-10 left-8 z-20 bg-white p-5 max-w-xs shadow-xl">
            <p className="text-[#c8923a] text-xs font-bold tracking-widest uppercase mb-2">FEATURED</p>
            <h2 className="text-[#32348A] font-black text-2xl leading-tight mb-1">{auctionName}</h2>
            {auctionDate && (
              <p className="text-gray-600 text-sm mb-4">
                {format(new Date(auctionDate), "EEEE do MMMM yyyy")}
              </p>
            )}
            <Link
              href={`/auctions/${auctionCode}`}
              className="block w-full bg-[#32348A] hover:bg-[#28296e] text-white text-xs font-bold tracking-widest text-center py-3 px-6 uppercase transition-colors"
            >
              VIEW LOTS
            </Link>
          </div>

          {/* Dot pagination */}
          <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex gap-1.5 z-20">
            {Array.from({ length: Math.min(totalLots, 20) }).map((_, i) => (
              <div
                key={i}
                className={`rounded-full transition-all ${
                  i === (auction?.currentLotIndex ?? 0) % 20
                    ? "w-3 h-3 bg-white"
                    : "w-2 h-2 bg-white/40"
                }`}
              />
            ))}
          </div>
        </div>

        {/* RIGHT — live panel */}
        <div className="w-[420px] shrink-0 flex flex-col border-l border-gray-200 bg-white">

          {/* Header */}
          <div className="px-5 pt-5 pb-3 border-b border-gray-100">
            <p className="text-[#2AB4A6] text-xs font-bold tracking-widest uppercase mb-0.5">LIVE AUCTION</p>
            <h3 className="text-[#32348A] font-black text-xl leading-tight">{auctionName}</h3>
            {auctionDate && (
              <p className="text-gray-500 text-sm mt-0.5">
                {format(new Date(auctionDate), "d MMMM yyyy")} | {format(new Date(auctionDate), "HH:mm")}
              </p>
            )}
          </div>

          {/* Video / stream area */}
          <div className="relative bg-black mx-5 mt-4 rounded overflow-hidden" style={{ aspectRatio: "16/9" }}>
            <div className="absolute inset-0 flex items-center justify-center bg-gray-900">
              {displayImg ? (
                <Image src={displayImg} alt="" fill className="object-cover opacity-60" />
              ) : null}
              <div className="relative z-10 text-center">
                <div className="w-14 h-14 rounded-full bg-white/20 border-2 border-white flex items-center justify-center mx-auto mb-2 cursor-pointer hover:bg-white/30 transition-colors">
                  <svg className="w-6 h-6 text-white ml-1" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M8 5v14l11-7z"/>
                  </svg>
                </div>
                <p className="text-white/70 text-xs">Live stream</p>
              </div>
            </div>
            {/* LIVE badge */}
            <div className="absolute top-2 right-2 z-20 bg-red-600 text-white text-[10px] font-black px-2 py-0.5 rounded tracking-widest">
              LIVE
            </div>
          </div>

          {/* Current lot info */}
          <div className="mx-5 mt-3 flex gap-3 pb-3 border-b border-gray-100">
            {/* Lot thumbnail */}
            {displayImg && (
              <div className="relative w-16 h-16 shrink-0 border border-gray-200 overflow-hidden rounded">
                <Image src={displayImg} alt="" fill className="object-cover" />
              </div>
            )}
            <div className="flex-1 min-w-0">
              <p className="text-[#32348A] text-xs font-black tracking-widest uppercase">
                LOT {lot?.barcode ?? fallbackLot?.barcode ?? "—"}
              </p>
              <p className="text-gray-700 text-sm font-medium leading-snug line-clamp-2">
                {lot?.title ?? fallbackLot?.title ?? "Loading…"}
              </p>
              {(lot?.estimateLow || fallbackLot?.estimateLow) && (
                <p className="text-gray-500 text-xs mt-0.5">
                  Estimate: <strong className="text-gray-700">
                    {fmt(lot?.estimateLow ?? fallbackLot?.estimateLow)} – {fmt(lot?.estimateHigh ?? fallbackLot?.estimateHigh)}
                  </strong>
                </p>
              )}
            </div>
          </div>

          {/* Bid status */}
          <div className="mx-5 mt-3 space-y-2">
            <div className="flex items-center justify-between text-sm">
              <span className="text-gray-600 font-medium">Current Bid:</span>
              <div className="flex items-center gap-3">
                <span className="text-gray-500 text-xs">{lastBidderName ?? "—"}</span>
                <span className={`font-black text-lg transition-colors ${bidFlash ? "text-green-600" : "text-[#32348A]"}`}>
                  {fmt(lot?.currentBid ?? 0)}
                </span>
              </div>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-gray-600 font-medium">Asking Bid:</span>
              <span className="font-semibold text-gray-800">{fmt(lot?.askingBid)}</span>
            </div>
            {fairWarning && (
              <div className="bg-amber-50 border border-amber-300 text-amber-700 text-xs font-bold text-center py-2 rounded tracking-wider animate-pulse">
                ⚠️ FAIR WARNING
              </div>
            )}
          </div>

          {/* Action buttons */}
          <div className="mx-5 mt-4 mb-5 flex flex-col gap-2">
            <div className="grid grid-cols-2 gap-2">
              <Link
                href="/portal/register"
                className="border-2 border-[#32348A] text-[#32348A] hover:bg-[#32348A] hover:text-white text-xs font-black text-center py-3 tracking-widest uppercase transition-colors"
              >
                BID LIVE
              </Link>
              <Link
                href={`/auctions/${auctionCode}`}
                className="bg-[#32348A] hover:bg-[#28296e] text-white text-xs font-black text-center py-3 tracking-widest uppercase transition-colors"
              >
                VIEW LOTS
              </Link>
            </div>
            <Link
              href="/portal/register"
              className="border border-gray-300 text-[#32348A] hover:bg-gray-50 text-xs font-bold text-center py-3 tracking-widest uppercase transition-colors"
            >
              APPROVED TO BID LIVE
            </Link>
          </div>

        </div>
      </div>
    </div>
  )
}
