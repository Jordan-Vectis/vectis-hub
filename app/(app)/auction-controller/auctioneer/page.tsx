"use client"

import { useEffect, useRef, useState } from "react"
import { io as ioClient, Socket } from "socket.io-client"
import { lotPhotoUrl } from "@/lib/photo-url"

interface BidEntry {
  amount: number
  type: string
  bidderId?: string
  bidderName?: string
  timestamp: string
}

interface AutoBid {
  bidderId: string
  maxAmount: number
}

interface LiveLot {
  id: string
  lotNumber: string
  title: string
  description: string
  imageUrls: string[]
  estimateLow: number | null
  estimateHigh: number | null
  status: string
  currentBid: number
  askingBid: number
  increment: number
  hammerPrice: number | null
  bids: BidEntry[]
  topAutoBid: AutoBid | null
}

interface PreviousLot {
  lotNumber: string
  title: string
  status: string
  hammerPrice: number | null
  buyerName: string | null
  buyerId: string | null
}

interface AuctionState {
  auction: {
    title: string
    code: string
    status: string
    currentLotIndex: number
    fairWarning: boolean
    pauseMessage: string | null
    totalLots: number
  } | null
  currentLot: LiveLot | null
  lots: { id: string; lotNumber: string; status: string; hammerPrice: number | null; currentBid: number }[]
  onlineCount: number
  hoveringCount: number
  previousLot: PreviousLot | null
}

function fmt(n: number | null | undefined) {
  if (!n && n !== 0) return "—"
  return `£${n.toLocaleString("en-GB")}`
}

export default function AuctioneerPage() {
  const [state, setState] = useState<AuctionState | null>(null)
  const [hoveringCount, setHoveringCount] = useState(0)
  const [bidFlash, setBidFlash] = useState(false)
  const [hammerFlash, setHammerFlash] = useState(false)
  const [fairWarning, setFairWarning] = useState(false)
  const [watchError, setWatchError] = useState<string | null>(null)
  const socketRef = useRef<Socket | null>(null)

  useEffect(() => {
    const socket = ioClient(window.location.origin, { transports: ["websocket", "polling"] })
    socketRef.current = socket

    socket.on("connect", () => {
      // Join as a viewer so we get state updates
      socket.emit("bidder:join", { name: "Auctioneer View" })
      // Bidder names and the top commission bid come only to staff with Auction Controller access.
      socket.emit("staff:watch")
    })
    socket.on("staff:watch:fail", ({ message }: { message: string }) => setWatchError(message))

    socket.on("auction:state", (s: AuctionState) => {
      setState(s)
      setHoveringCount(s.hoveringCount ?? 0)
      setFairWarning(s.auction?.fairWarning ?? false)
    })

    socket.on("bid:new", () => {
      setBidFlash(true)
      setTimeout(() => setBidFlash(false), 600)
    })

    socket.on("lot:hammer", () => {
      setHammerFlash(true)
      setTimeout(() => setHammerFlash(false), 2000)
    })

    socket.on("auction:fairWarning", () => setFairWarning(true))

    socket.on("bidder:hoveringCount", ({ count }: { count: number }) => {
      setHoveringCount(count)
    })

    return () => { socket.disconnect() }
  }, [])

  const lot = state?.currentLot
  const auction = state?.auction
  const prevLot = state?.previousLot
  const lastBid = lot?.bids?.[lot.bids.length - 1]

  // Bidder type label
  const bidderType = lastBid?.type === "Auto" ? "Vectis Auto"
    : lastBid?.type === "Online" ? "Vectis Live"
    : lastBid?.type === "Telephone" ? "Vectis Telephone"
    : lastBid?.type ? `Vectis ${lastBid.type}`
    : null

  const imgUrl = lot?.imageUrls?.[0] ? lotPhotoUrl(lot.imageUrls[0]) : null
  const progress = auction ? Math.round(((auction.currentLotIndex + 1) / auction.totalLots) * 100) : 0

  return (
    <div className="min-h-screen bg-[#1a1a2e] text-white flex flex-col select-none" style={{ fontFamily: "system-ui, sans-serif" }}>

      {watchError && (
        <div className="bg-amber-900/60 text-amber-100 text-sm px-4 py-2 text-center">
          Bidder names and commission bids are hidden — {watchError}
        </div>
      )}

      {/* ── Hover alert bar ── */}
      {hoveringCount > 0 && (
        <div className="bg-amber-500 animate-pulse px-4 py-1.5 flex items-center gap-3 justify-center">
          <span className="w-2 h-2 rounded-full bg-white animate-ping shrink-0" />
          <span className="text-black font-black text-sm tracking-wider uppercase">
            {hoveringCount} bidder{hoveringCount !== 1 ? "s" : ""} ready to bid
          </span>
        </div>
      )}

      {/* ── Header ── */}
      <div className={`flex items-center justify-between px-6 py-3 border-b transition-colors ${
        fairWarning ? "bg-amber-600 border-amber-500" :
        hammerFlash ? "bg-green-700 border-green-600" :
        "bg-[#16213e] border-white/10"
      }`}>
        <div className="flex items-center gap-4">
          <span className="text-2xl font-black tracking-tight">
            {lot ? `LOT ${lot.lotNumber}` : "WAITING…"}
          </span>
          {auction && (
            <span className="text-slate-400 text-sm font-semibold">{auction.title}</span>
          )}
          {fairWarning && (
            <span className="bg-white text-amber-600 text-xs font-black px-3 py-1 rounded animate-pulse tracking-widest uppercase">
              ⚠️ Fair Warning
            </span>
          )}
          {hammerFlash && (
            <span className="bg-white text-green-700 text-xs font-black px-3 py-1 rounded tracking-widest uppercase animate-bounce">
              🔨 SOLD
            </span>
          )}
        </div>

        <div className="flex items-center gap-4">
          <span className="text-slate-400 text-sm">🌐 {state?.onlineCount ?? 0} online</span>
          {auction && (
            <span className="text-slate-500 text-xs">
              Lot {auction.currentLotIndex + 1} of {auction.totalLots}
            </span>
          )}
          <span className="text-[#2AB4A6] font-black text-sm">VECTIS</span>
        </div>
      </div>

      {/* ── Progress bar ── */}
      {auction && (
        <div className="h-1 bg-white/10">
          <div
            className="h-full bg-[#2AB4A6] transition-all duration-500"
            style={{ width: `${progress}%` }}
          />
        </div>
      )}

      {/* ── Pause message banner ── */}
      {state?.auction?.pauseMessage && (
        <div className="bg-amber-600 px-6 py-6 flex flex-col items-center text-center border-b border-amber-500">
          <p className="text-black font-black text-3xl uppercase tracking-widest mb-1">⏸ SALE PAUSED</p>
          <p className="text-black/80 text-lg font-semibold">{state.auction.pauseMessage}</p>
        </div>
      )}

      {/* ── No active auction ── */}
      {!lot && (
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center">
            <div className="text-6xl mb-4">🔨</div>
            <p className="text-slate-400 text-xl font-semibold">Waiting for auction to start…</p>
            <p className="text-slate-600 text-sm mt-2">The clerk will start the sale from the operator panel</p>
          </div>
        </div>
      )}

      {/* ── Main display ── */}
      {lot && (
        <div className="flex flex-1 overflow-hidden">

          {/* LEFT — Lot info */}
          <div className="w-[420px] shrink-0 flex flex-col border-r border-white/10 bg-[#16213e]">

            {/* Lot image */}
            <div className="relative bg-[#0d1117]" style={{ height: "280px" }}>
              {imgUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={imgUrl} alt={lot.title} className="w-full h-full object-contain p-3" />
              ) : (
                <div className="w-full h-full flex items-center justify-center text-slate-700">
                  <svg className="w-24 h-24" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                  </svg>
                </div>
              )}
            </div>

            {/* Lot details */}
            <div className="p-5 flex-1 flex flex-col">
              <p className="text-slate-400 text-xs font-bold uppercase tracking-wider mb-1">Lot {lot.lotNumber}</p>
              <p className="text-white font-bold text-base leading-snug mb-4 line-clamp-3">{lot.title}</p>

              <div className="flex items-center gap-2 mb-4">
                <span className="text-slate-400 text-sm">Guide Price</span>
                <span className="text-white font-black text-lg">
                  {fmt(lot.estimateLow)}{lot.estimateHigh ? ` – ${fmt(lot.estimateHigh)}` : ""}
                </span>
              </div>

              {/* Counters */}
              <div className="flex items-center gap-4 mb-4 text-sm">
                <span className="text-slate-400">
                  Live bidders: <span className="text-white font-bold">{state?.onlineCount ?? 0}</span>
                </span>
                {hoveringCount > 0 && (
                  <span className="text-amber-400 font-bold animate-pulse">
                    {hoveringCount} hovering
                  </span>
                )}
              </div>

              {/* Previous lot */}
              {prevLot && (
                <div className="mt-auto pt-4 border-t border-white/10">
                  <p className="text-slate-500 text-xs">
                    <span className="font-bold text-slate-400">Previous Lot: </span>
                    LOT {prevLot.lotNumber}
                    {prevLot.status === "SOLD"
                      ? ` — Buyer ${prevLot.buyerId ?? prevLot.buyerName ?? "—"}, Sold ${fmt(prevLot.hammerPrice)}`
                      : ` — ${prevLot.status}`}
                  </p>
                </div>
              )}
            </div>
          </div>

          {/* RIGHT — Bid display */}
          <div className="flex-1 flex flex-col bg-[#0f3460]">

            {/* Big current bid */}
            <div className="flex-1 flex flex-col items-center justify-center p-8">
              <div className={`transition-all duration-300 ${bidFlash ? "scale-110" : "scale-100"}`}>
                <p className={`text-8xl font-black text-center tracking-tight transition-colors ${
                  bidFlash ? "text-[#2AB4A6]" : "text-white"
                }`}>
                  {lot.currentBid > 0 ? fmt(lot.currentBid) : "—"}
                </p>
              </div>

              {bidderType && (
                <p className="text-[#2AB4A6] font-bold text-xl mt-3 text-center">{bidderType}</p>
              )}

              {lastBid && (
                <div className="mt-4 text-center">
                  <p className="text-slate-300 text-sm">
                    {lastBid.bidderName && <span>{lastBid.bidderName}</span>}
                    {lastBid.bidderId && <span className="text-slate-500 ml-2">ID: {lastBid.bidderId}</span>}
                  </p>
                </div>
              )}
            </div>

            {/* Divider */}
            <div className="border-t border-white/20 mx-6" />

            {/* Bid info rows */}
            <div className="p-6 space-y-3">
              <div className="flex items-center justify-between py-2 border-b border-white/10">
                <span className="text-slate-400 text-sm font-bold uppercase tracking-widest">Current Bid</span>
                <span className="text-white font-black text-xl">{fmt(lot.currentBid)}</span>
              </div>

              <div className="flex items-center justify-between py-2 border-b border-white/10">
                <span className="text-slate-400 text-sm font-bold uppercase tracking-widest">Asking Bid</span>
                <span className="text-[#2AB4A6] font-black text-xl">{fmt(lot.askingBid)}</span>
              </div>

              <div className="flex items-center justify-between py-2">
                <span className="text-slate-400 text-sm font-bold uppercase tracking-widest">Top AAB / Autobid</span>
                <span className="text-amber-400 font-black text-xl">
                  {lot.topAutoBid
                    ? `${fmt(lot.topAutoBid.maxAmount)} (${lot.topAutoBid.bidderId})`
                    : "—"}
                </span>
              </div>
            </div>
          </div>

        </div>
      )}

      {/* ── Lot strip ── */}
      {state?.lots && state.lots.length > 0 && (
        <div className="border-t border-white/10 bg-[#0d1117] px-4 py-2 flex gap-1.5 overflow-x-auto">
          {state.lots.map((l, i) => {
            const isActive = i === (auction?.currentLotIndex ?? -1)
            return (
              <div
                key={l.id}
                title={`Lot ${l.lotNumber}`}
                className={`shrink-0 w-9 h-9 rounded text-[10px] font-bold flex items-center justify-center transition-colors ${
                  isActive ? "bg-[#2AB4A6] text-white ring-2 ring-white" :
                  l.status === "SOLD" ? "bg-green-900/60 text-green-400" :
                  l.status === "PASSED" || l.status === "WITHDRAWN" ? "bg-red-900/40 text-red-400" :
                  "bg-[#1e293b] text-slate-500"
                }`}
              >
                {l.lotNumber.replace(/^[A-Z]+0*/i, "") || l.lotNumber}
              </div>
            )
          })}
        </div>
      )}

    </div>
  )
}
