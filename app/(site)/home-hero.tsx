"use client"

import { useEffect, useRef, useState } from "react"
import Image from "next/image"
import Link from "next/link"
import { io, Socket } from "socket.io-client"

interface Slide {
  title: string
  subtitle: string
  cta: string
  ctaHref: string
  imageKey?: string | null
}

const DEFAULT_SLIDES: Slide[] = [
  {
    title: "World's No.1 Diecast Specialist",
    subtitle: "Tens of thousands of lots sold every year to collectors worldwide. Join our next auction.",
    cta: "VIEW UPCOMING AUCTIONS",
    ctaHref: "/auctions",
  },
  {
    title: "Sell Your Collection",
    subtitle: "Free valuations from our specialist team. No fees, no fuss — just the best price for your collection.",
    cta: "GET A FREE VALUATION",
    ctaHref: "/submit",
  },
  {
    title: "Bid Live & Online",
    subtitle: "Register once and bid in real-time from anywhere in the world across 100+ auctions a year.",
    cta: "REGISTER TO BID",
    ctaHref: "/portal/register",
  },
]

interface LiveLot {
  id: string
  barcode: string
  title: string
  imageUrls: string[]
  estimateLow: number | null
  estimateHigh: number | null
}

interface AuctionState {
  auction: {
    id: string
    title: string
    code: string
    status: string
    currentLotIndex: number
    totalLots: number
  } | null
  currentLot: {
    id: string
    barcode: string
    title: string
    imageUrls: string[]
    estimateLow: number | null
    estimateHigh: number | null
    currentBid: number
    askingBid: number
  } | null
  lots: LiveLot[]
}

interface DbSlide {
  id: string
  title: string
  subtitle: string
  cta: string
  ctaHref: string
  imageKey: string | null
}

interface Props {
  initialLive: {
    auctionId: string
    auctionCode: string
    auctionName: string
    currentLotIndex: number
    status: string
    lots: LiveLot[]
  } | null
  dbSlides: DbSlide[]
  isLoggedIn: boolean
}

export default function HomeHero({ initialLive, dbSlides, isLoggedIn }: Props) {
  const SLIDES: Slide[] = dbSlides.length > 0 ? dbSlides : DEFAULT_SLIDES
  const [slide, setSlide] = useState(0)
  const [live, setLive] = useState(initialLive)
  const [auctionState, setAuctionState] = useState<AuctionState | null>(null)
  const timerRef   = useRef<ReturnType<typeof setInterval> | null>(null)
  const socketRef  = useRef<Socket | null>(null)  // kept for cleanup

  const isLive = !!live && ["ACTIVE", "PAUSED"].includes(live.status)

  // Auto-slide (pauses when live is showing)
  useEffect(() => {
    if (isLive) {
      if (timerRef.current) clearInterval(timerRef.current)
      return
    }
    timerRef.current = setInterval(() => setSlide(s => (s + 1) % SLIDES.length), 5000)
    return () => { if (timerRef.current) clearInterval(timerRef.current) }
  }, [isLive])

  // Socket.IO for live updates
  useEffect(() => {
    const socket = io({ path: "/socket.io" })
    socketRef.current = socket

    socket.on("auction:state", (data: AuctionState) => {
      setAuctionState(data)
      if (data.auction && ["ACTIVE", "PAUSED"].includes(data.auction.status)) {
        setLive(prev => ({
          auctionId:       data.auction!.id,
          auctionCode:     data.auction!.code,
          auctionName:     data.auction!.title,
          currentLotIndex: data.auction!.currentLotIndex,
          status:          data.auction!.status,
          lots:            prev?.lots ?? [],
        }))
      } else {
        setLive(null)
      }
    })

    return () => { socket.disconnect() }
  }, [])

  // Prefer real-time socket data, fall back to SSR initial data
  const currentLot = auctionState?.currentLot ?? (
    live ? live.lots[live.currentLotIndex] ?? null : null
  )
  const currentBid = auctionState?.currentLot?.currentBid ?? null
  const askingBid  = auctionState?.currentLot?.askingBid ?? null
  const lotImg = currentLot?.imageUrls?.[0]
    ? `/api/public/photo?key=${encodeURIComponent(currentLot.imageUrls[0])}`
    : null

  return (
    <div className="relative overflow-hidden" style={{ height: "520px" }}>
      {/* ── Hero slides (shrinks left when live) ── */}
      <div
        className="absolute top-0 left-0 h-full transition-all duration-700 ease-in-out"
        style={{ width: isLive ? "58%" : "100%" }}
      >
        {SLIDES.map((s, i) => {
          const bgImg = s.imageKey
            ? `/api/public/photo?key=${encodeURIComponent(s.imageKey)}`
            : null
          return (
            <div
              key={i}
              className={`absolute inset-0 transition-opacity duration-1000 ${i === slide ? "opacity-100" : "opacity-0 pointer-events-none"}`}
            >
              {/* Background — image or gradient */}
              <div className="absolute inset-0 bg-gradient-to-br from-[#1a1b3a] via-[#32348A] to-[#32348A]" />
              {bgImg && (
                <Image
                  src={bgImg}
                  alt={s.title}
                  fill
                  className="object-cover opacity-40"
                  unoptimized
                  priority={i === 0}
                />
              )}
              {/* Decorative pattern */}
              <div className="absolute inset-0 opacity-5"
                style={{ backgroundImage: "radial-gradient(circle, white 1px, transparent 1px)", backgroundSize: "40px 40px" }}
              />
              <div className="relative h-full flex flex-col justify-center px-12 max-w-2xl">
                {/* Mini logo watermark */}
                <div className="flex items-center gap-2 mb-6">
                  <div className="h-px w-8 bg-[#DB0606]" />
                  <p className="text-[#DB0606] text-[10px] font-black tracking-[0.35em] uppercase">
                    Vectis Auctions · Est. 1995
                  </p>
                </div>
                <h1 className="text-white font-black text-4xl sm:text-5xl leading-none mb-5 uppercase tracking-tight">
                  {s.title}
                </h1>
                <p className="text-gray-300 text-sm mb-8 leading-relaxed max-w-lg">
                  {s.subtitle}
                </p>
                <div className="flex gap-3">
                  <Link
                    href={s.ctaHref}
                    className="bg-[#DB0606] hover:bg-[#b00505] text-white text-xs font-black uppercase tracking-widest px-7 py-3.5 transition-colors"
                  >
                    {s.cta}
                  </Link>
                  {!isLoggedIn && (
                    <Link
                      href="/portal/register"
                      className="border-2 border-white/30 hover:border-white text-white text-xs font-black uppercase tracking-widest px-7 py-3.5 transition-colors"
                    >
                      REGISTER FREE
                    </Link>
                  )}
                </div>
              </div>
            </div>
          )
        })}

        {/* Slide dots */}
        {!isLive && (
          <div className="absolute bottom-6 left-12 flex gap-2">
            {SLIDES.map((_, i) => (
              <button
                key={i}
                onClick={() => setSlide(i)}
                className={`h-1 rounded-none transition-all ${i === slide ? "bg-[#DB0606] w-8" : "bg-white/30 w-4 hover:bg-white/60"}`}
              />
            ))}
          </div>
        )}

        {/* Live indicator overlay on hero */}
        {isLive && (
          <div className="absolute top-6 left-6 flex items-center gap-2 bg-red-600 text-white text-xs font-black uppercase tracking-widest px-3 py-1.5">
            <span className="w-2 h-2 rounded-full bg-white animate-pulse" />
            AUCTION IN PROGRESS
          </div>
        )}
      </div>

      {/* ── Live auction panel (slides in from right) ── */}
      <div
        className="absolute top-0 right-0 h-full bg-[#12134a] transition-all duration-700 ease-in-out overflow-hidden"
        style={{ width: isLive ? "42%" : "0%" }}
      >
        {isLive && live && currentLot && (
          <div className="h-full flex flex-col">
            {/* Header */}
            <div className="bg-red-600 px-5 py-3 flex items-center justify-between shrink-0">
              <div className="flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full bg-white animate-pulse" />
                <span className="text-white text-xs font-black uppercase tracking-widest">LIVE AUCTION</span>
              </div>
              <Link
                href={`/auctions/${live.auctionCode}/live`}
                className="text-white text-[10px] font-bold uppercase tracking-wider hover:underline"
              >
                ENTER BIDDING ROOM →
              </Link>
            </div>

            {/* Lot image */}
            <div className="relative flex-1 bg-black min-h-0">
              {lotImg ? (
                <Image src={lotImg} alt={currentLot.title} fill className="object-contain p-4" unoptimized />
              ) : (
                <div className="absolute inset-0 flex items-center justify-center text-gray-700">
                  <svg className="w-20 h-20" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                  </svg>
                </div>
              )}
            </div>

            {/* Lot info */}
            <div className="shrink-0 px-5 py-4 bg-[#12134a] border-t border-white/10">
              <p className="text-[#2AB4A6] text-[10px] font-black uppercase tracking-widest mb-1">
                LOT {currentLot.barcode || "—"}
              </p>
              <p className="text-white font-bold text-sm leading-snug line-clamp-2 mb-3">
                {currentLot.title}
              </p>
              <div className="grid grid-cols-2 gap-3 mb-4">
                <div className="bg-black/40 px-3 py-2">
                  <p className="text-gray-500 text-[9px] uppercase tracking-widest mb-0.5">Current Bid</p>
                  <p className="text-white font-black text-lg">
                    {currentBid ? `£${currentBid.toLocaleString("en-GB")}` : "—"}
                  </p>
                </div>
                <div className="bg-[#2AB4A6]/20 px-3 py-2 border border-[#2AB4A6]/40">
                  <p className="text-[#2AB4A6] text-[9px] uppercase tracking-widest mb-0.5">Asking</p>
                  <p className="text-[#2AB4A6] font-black text-lg">
                    {askingBid ? `£${askingBid.toLocaleString("en-GB")}` : (
                      currentLot.estimateLow
                        ? `£${currentLot.estimateLow.toLocaleString("en-GB")}`
                        : "TBC"
                    )}
                  </p>
                </div>
              </div>
              <Link
                href={`/auctions/${live.auctionCode}/live`}
                className="block w-full text-center bg-red-600 hover:bg-red-500 text-white text-xs font-black uppercase tracking-widest py-3 transition-colors"
              >
                BID LIVE NOW →
              </Link>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
