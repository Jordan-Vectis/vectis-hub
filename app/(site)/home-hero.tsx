"use client"

import { useEffect, useRef, useState } from "react"
import Link from "next/link"
import { io, Socket } from "socket.io-client"
import SlideView, { type SlideData } from "./hero-slide-view"
import { DEFAULT_STYLE } from "./hero-style"

// The home page banner, laid out as vectis.co.uk's (2026-10-15): inside the page's margins, the
// slides on the left (one per upcoming sale, rotating, with the caption card bottom-left and the
// dots along the bottom) and two picture boxes on the right — "Sell with us" and "Buy with us",
// each a photo with a white card on it. When a Hub sale is live the right column shows the live
// lot and its bids instead.

// The slides shown until there is a sale to feature or a Banner Manager slide; no picture, the default look.
const DEFAULT_SLIDES: SlideData[] = [
  {
    title: "The world's leading toy and collectables auction house",
    subtitle: "Over 70,000 lots a year",
    cta: "View auctions",
    ctaHref: "/auctions",
  },
  {
    title: "Sell your collection with us",
    subtitle: "Free valuations, one commission",
    cta: "Get started",
    ctaHref: "/sell-with-us",
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

/** A slide (a featured sale, or one from the Banner Manager), with its picture already signed by the page and its look already parsed. */
export type DbSlide = SlideData & { id: string }

/** The pictures behind the two boxes beside the slider (signed by the page), or null for a plain band. */
export type SidePictures = { sell: string | null; buy: string | null }

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
  sidePictures: SidePictures
  isLoggedIn: boolean
}

export default function HomeHero({ initialLive, dbSlides, sidePictures, isLoggedIn }: Props) {
  const SLIDES: SlideData[] = dbSlides.length > 0 ? dbSlides : DEFAULT_SLIDES
  const [slide, setSlide] = useState(0)
  const [live, setLive] = useState(initialLive)
  const [auctionState, setAuctionState] = useState<AuctionState | null>(null)
  const socketRef = useRef<Socket | null>(null)  // kept for cleanup

  const isLive = !!live && ["ACTIVE", "PAUSED"].includes(live.status)

  // Auto-slide: each slide stays for its own number of seconds (set in the Banner Manager; the
  // featured sales use the default). Pauses while a live auction is showing; nothing to rotate
  // with a single slide.
  useEffect(() => {
    if (isLive || SLIDES.length < 2) return
    const seconds = (SLIDES[slide]?.style ?? DEFAULT_STYLE).seconds
    const t = setTimeout(() => setSlide(s => (s + 1) % SLIDES.length), seconds * 1000)
    return () => clearTimeout(t)
  }, [slide, isLive, SLIDES])

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
    <section className="bg-white pt-3 lg:pt-5">
      <div className="vs-container-wide">
        <div className={`grid grid-cols-1 gap-3 ${isLive ? "lg:grid-cols-[1fr_420px]" : "lg:grid-cols-[2fr_1fr]"}`}>
          {/* ── The slides ── */}
          <div className="vs-hero overflow-hidden">
            {/* One rendering of a slide (hero-slide-view.tsx) — the Banner Manager's preview uses the same one. */}
            {SLIDES.map((s, i) => (
              <div
                key={i}
                className={`absolute inset-0 transition-opacity duration-700 ${i === slide ? "opacity-100" : "opacity-0 pointer-events-none"}`}
                aria-hidden={i !== slide}
              >
                <SlideView slide={s} isLoggedIn={isLoggedIn} eager={i === 0} />
              </div>
            ))}

            {/* Slide dots along the bottom, as on vectis.co.uk — one per slide, none for a single slide. Each sits in a finger-sized button. */}
            {!isLive && SLIDES.length > 1 && (
              <div className="absolute bottom-2 inset-x-0 flex flex-wrap justify-center px-4" role="tablist" aria-label="Banner slides">
                {SLIDES.map((s, i) => (
                  <button
                    key={i}
                    type="button"
                    role="tab"
                    onClick={() => setSlide(i)}
                    aria-label={`Slide ${i + 1}: ${s.title}`}
                    aria-selected={i === slide}
                    className="p-[7px]"
                  >
                    <span className="vs-hero-dot block" aria-current={i === slide ? "true" : undefined} />
                  </button>
                ))}
              </div>
            )}

            {/* Live indicator overlay on hero */}
            {isLive && (
              <div className="absolute top-5 left-5 flex items-center gap-2 bg-[var(--vs-red)] text-white vs-caps px-3 py-1.5">
                <span className="w-2 h-2 rounded-full bg-white animate-pulse" />
                Auction in progress
              </div>
            )}
          </div>

          {/* ── Right-hand column: the two picture boxes — or the live sale when one is running ── */}
          {isLive && live && currentLot ? (
            <aside className="bg-[var(--vs-navy)] text-white flex flex-col lg:h-[600px]" aria-label="Live auction">
              <div className="bg-[var(--vs-red)] px-5 py-3 flex items-center justify-between shrink-0">
                <div className="flex items-center gap-2">
                  <span className="w-2.5 h-2.5 rounded-full bg-white animate-pulse" />
                  <span className="vs-caps">Live auction</span>
                </div>
                <Link href={`/auctions/${live.auctionCode}/live`} className="vs-caps text-xs hover:underline">
                  Enter bidding room ›
                </Link>
              </div>
              <div className="relative flex-1 bg-black min-h-[220px]">
                {lotImg ? (
                  <img src={lotImg} alt={currentLot.title} className="absolute inset-0 w-full h-full object-contain p-4" />
                ) : (
                  <div className="absolute inset-0 flex items-center justify-center text-white/30">
                    <img src="/vectis-logo.svg" alt="" width={140} height={56} className="opacity-40" />
                  </div>
                )}
              </div>
              <div className="shrink-0 px-5 py-4 border-t border-white/10">
                <p className="vs-caps text-white/70 text-xs mb-1">Lot {currentLot.barcode || "—"}</p>
                <p className="font-medium text-base leading-snug line-clamp-2 mb-3">{currentLot.title}</p>
                <div className="grid grid-cols-2 gap-3 mb-4">
                  <div className="bg-black/30 px-3 py-2">
                    <p className="text-white/60 text-xs uppercase tracking-wider mb-0.5">Current bid</p>
                    <p className="font-semibold text-lg">{currentBid ? `£${currentBid.toLocaleString("en-GB")}` : "—"}</p>
                  </div>
                  <div className="bg-white/10 px-3 py-2 border border-white/30">
                    <p className="text-white/60 text-xs uppercase tracking-wider mb-0.5">Asking</p>
                    <p className="font-semibold text-lg">
                      {askingBid ? `£${askingBid.toLocaleString("en-GB")}` : currentLot.estimateLow ? `£${currentLot.estimateLow.toLocaleString("en-GB")}` : "TBC"}
                    </p>
                  </div>
                </div>
                <Link href={`/auctions/${live.auctionCode}/live`} className="vs-btn vs-btn-red vs-btn-block">Bid live now</Link>
              </div>
            </aside>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-1 gap-3 lg:h-[600px]">
              <div className="vs-hero-box">
                {sidePictures.sell && <img src={sidePictures.sell} alt="" loading="lazy" />}
                <div className="vs-hero-box-card">
                  <h3 className="vs-h3 font-medium mb-3">Sell with us</h3>
                  <p className="text-sm leading-relaxed mb-4">We buy or auction your collection here at Vectis Auctions, the world&apos;s largest collectable toy specialist.</p>
                  <Link href="/sell-with-us" className="vs-link">Get started</Link>
                </div>
              </div>
              <div className="vs-hero-box">
                {sidePictures.buy && <img src={sidePictures.buy} alt="" loading="lazy" />}
                <div className="vs-hero-box-card">
                  <h3 className="vs-h3 font-medium mb-3">Buy with us</h3>
                  <p className="text-sm leading-relaxed mb-4">Vectis holds more collectable toy auctions than any other auction house.</p>
                  <Link href="/how-to-bid" className="vs-link">Find out more</Link>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </section>
  )
}
