"use client"

import { useEffect, useState } from "react"
import { io as ioClient } from "socket.io-client"
import Link from "next/link"
import { lotPhotoUrl } from "@/lib/photo-url"
import { saleDateLong } from "../site-dates"

// The takeover at the top of the Auction Calendar while a Hub sale is running: the lot under the
// hammer large on the left with a caption card, and on the right the live panel — the way into
// the bidding room, the lot, the current and asking bids, fair warning — on navy, like the home
// page's live panel. The figures arrive over the same socket the bidding room uses.

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
  return `£${n.toLocaleString("en-GB")}`
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

  const estLow = lot?.estimateLow ?? fallbackLot?.estimateLow ?? null
  const estHigh = lot?.estimateHigh ?? fallbackLot?.estimateHigh ?? null
  const dateLine = auctionDate ? saleDateLong(new Date(auctionDate)) : ""
  const liveHref = `/auctions/${auctionCode}/live`
  const lotsHref = `/auctions/${auctionCode}`

  return (
    <section className="bg-[var(--vs-navy)] text-white" aria-label="Live auction in progress">
      {/* The red strip says what is happening, in numbers. */}
      <div className="bg-[var(--vs-red)] px-4 py-2 text-center">
        <p className="vs-caps text-xs inline-flex items-center gap-2" role="status">
          <span className={`w-2 h-2 rounded-full bg-white shrink-0 ${connected ? "animate-pulse" : "opacity-50"}`} aria-hidden="true" />
          {connected
            ? `Live auction in progress · ${lotsSold} of ${totalLots} lots sold · ${state?.onlineCount ?? 0} watching`
            : "Connecting to the live auction…"}
        </p>
      </div>

      <div className="grid lg:grid-cols-[1fr_400px]">
        {/* ── The lot under the hammer, large; the caption card sits over it, or under it on a phone ── */}
        <div className="relative flex flex-col">
          <div className="relative flex-1 bg-black aspect-[4/3] sm:aspect-auto sm:min-h-[420px] lg:min-h-[560px]">
            {displayImg
              ? <img src={displayImg} alt={lot?.title ?? auctionName} className="absolute inset-0 w-full h-full object-contain" />
              : <div className="absolute inset-0 flex items-center justify-center"><img src="/vectis-logo.svg" alt="" width={160} height={64} className="opacity-30" /></div>}
            {fairWarning && <div className="absolute inset-0 bg-[var(--vs-red)] opacity-25 animate-pulse pointer-events-none" aria-hidden="true" />}
          </div>

          <div className="vs-card text-[var(--vs-ink)] p-5 m-4 sm:m-0 sm:absolute sm:left-8 sm:bottom-8 sm:w-80">
            <p className="vs-kicker mb-2">Live now</p>
            <h2 className="vs-h4 mb-1">{auctionName}</h2>
            {dateLine && <p className="text-sm text-[var(--vs-muted)] mb-4">{dateLine}</p>}
            <Link href={lotsHref} className="vs-btn vs-btn-block">View lots</Link>
          </div>
        </div>

        {/* ── The live panel ── */}
        <div className="flex flex-col gap-4 p-5 sm:p-6 border-t lg:border-t-0 lg:border-l border-white/15">
          <div>
            <p className="vs-caps text-xs text-white/70 mb-1">Live auction</p>
            <h3 className="vs-h3 !text-white">{auctionName}</h3>
            {dateLine && <p className="text-sm text-white/80 mt-1">{dateLine}</p>}
          </div>

          {/* The stream plays in the bidding room; this opens it. */}
          <Link href={liveHref} className="relative block aspect-video bg-black overflow-hidden group" aria-label="Enter the bidding room">
            {displayImg && <img src={displayImg} alt="" className="absolute inset-0 w-full h-full object-cover opacity-50 group-hover:opacity-65 transition-opacity" />}
            <span className="absolute inset-0 flex flex-col items-center justify-center gap-2">
              <span className="w-14 h-14 rounded-full border-2 border-white bg-white/15 group-hover:bg-white/30 transition-colors flex items-center justify-center">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5v14l11-7z" /></svg>
              </span>
              <span className="vs-caps text-xs">Enter the bidding room</span>
            </span>
            <span className="vs-badge vs-badge-red absolute top-2 right-2 text-xs !px-3">Live</span>
          </Link>

          {/* The lot */}
          <div className="flex gap-3 pb-4 border-b border-white/15">
            {displayImg && (
              <div className="w-16 h-16 shrink-0 bg-white overflow-hidden">
                <img src={displayImg} alt="" className="w-full h-full object-contain" />
              </div>
            )}
            <div className="flex-1 min-w-0">
              <p className="vs-caps text-xs text-white/70">Lot {lot?.barcode ?? fallbackLot?.barcode ?? "—"}</p>
              <p className="font-medium leading-snug line-clamp-2">{lot?.title ?? fallbackLot?.title ?? "Loading…"}</p>
              {(estLow || estHigh) && (
                <p className="text-sm text-white/70 mt-0.5">
                  Estimate: <span className="text-white">{fmt(estLow)} – {fmt(estHigh)}</span>
                </p>
              )}
            </div>
          </div>

          {/* The bidding — the current-bid box inverts for a moment as each new bid lands. */}
          <div className="grid grid-cols-2 gap-3">
            <div className={`px-3 py-2 transition-colors ${bidFlash ? "bg-white text-[var(--vs-navy)]" : "bg-black/30"}`}>
              <p className={`text-xs uppercase tracking-wider mb-0.5 ${bidFlash ? "opacity-70" : "text-white/60"}`}>Current bid</p>
              <p className="font-semibold text-lg leading-tight">{lot?.currentBid ? fmt(lot.currentBid) : "—"}</p>
              {lastBidderName && <p className="text-xs opacity-70 truncate">{lastBidderName}</p>}
            </div>
            <div className="px-3 py-2 bg-white/10 border border-white/30">
              <p className="text-xs uppercase tracking-wider text-white/60 mb-0.5">Asking</p>
              <p className="font-semibold text-lg leading-tight">{fmt(lot?.askingBid)}</p>
            </div>
          </div>
          {fairWarning && (
            <div className="text-center" role="status">
              <span className="vs-badge vs-badge-red animate-pulse">Fair warning</span>
            </div>
          )}

          {/* Where to go */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-1 gap-2 mt-auto">
            <Link href={liveHref} className="vs-btn vs-btn-red">Bid live now</Link>
            <Link href={lotsHref} className="vs-btn vs-btn-white">View lots</Link>
          </div>
          <p className="text-sm text-white/80">
            Not registered yet? <Link href="/portal/register" className="underline underline-offset-2 hover:text-white">Create an account</Link> to bid live.
          </p>
        </div>
      </div>
    </section>
  )
}
