"use client"

import { useEffect, useRef, useState } from "react"
import { io as ioClient, Socket } from "socket.io-client"
import Image from "next/image"
import Link from "next/link"
import { format } from "date-fns"

interface Lot {
  id: string
  barcode: string
  title: string
  description: string
  imageUrls: string[]       // already proxy-resolved
  estimateLow: number | null
  estimateHigh: number | null
  hammerPrice: number | null
  status: string
}

interface BidEntry {
  amount: number
  type: string
  bidderId?: string
  bidderName?: string
  timestamp: string
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
  bids: BidEntry[]
}

interface AuctionState {
  auction: {
    title: string; status: string; currentLotIndex: number
    fairWarning: boolean; pauseMessage: string | null; totalLots: number
  } | null
  currentLot: LiveLot | null
  lots: { id: string; barcode: string; status: string; hammerPrice: number | null; currentBid: number }[]
  onlineCount: number
}

interface Props {
  auctionId: string
  auctionName: string
  auctionCode: string
  auctionDate: string | null
  initialLotIndex: number
  isLive: boolean
  lots: Lot[]
  isLoggedIn: boolean
  isRegistered: boolean
  customerId: string | null
  customerName: string | null
}

function fmt(n: number | null | undefined) {
  if (!n && n !== 0) return "—"
  return `£${n.toLocaleString()}`
}

function fmtTime(iso: string) {
  try { return new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" }) }
  catch { return iso }
}

function bidTypeLabel(type: string): string {
  switch (type) {
    case "Online":    return "Vectis Live"
    case "Auto":      return "Vectis Auto"
    case "Telephone": return "Vectis Telephone"
    case "Room":      return "Sale Room"
    default:          return type ?? "—"
  }
}

export default function LiveBiddingRoom({
  auctionName, auctionCode, auctionDate, initialLotIndex, lots: initialLots,
  isLoggedIn, isRegistered, customerId, customerName,
}: Props) {
  const [state, setState] = useState<AuctionState | null>(null)
  const [fairWarning, setFairWarning] = useState(false)
  const [bidFlash, setBidFlash] = useState(false)
  const [connected, setConnected] = useState(false)
  const [descOpen, setDescOpen] = useState(false)
  const [autoScroll, setAutoScroll] = useState(true)
  const [imageIndex, setImageIndex] = useState(0)
  const [streamActive, setStreamActive] = useState(false)
  const [bidPending, setBidPending] = useState(false)
  const [bidFeedback, setBidFeedback] = useState<{ ok: boolean; msg: string } | null>(null)
  const [commissionModal, setCommissionModal] = useState<{ lotId: string; barcode: string; title: string; estimateLow: number | null; estimateHigh: number | null; imageUrl: string | null; status: string } | null>(null)
  const [commissionAmount, setCommissionAmount] = useState("")
  const [commissionPending, setCommissionPending] = useState(false)
  const [commissionFeedback, setCommissionFeedback] = useState<{ ok: boolean; msg: string } | null>(null)
  const stripRef = useRef<HTMLDivElement>(null)

  const socketRef = useRef<Socket | null>(null)
  const remoteVideoRef = useRef<HTMLVideoElement>(null)
  const peerConnectionRef = useRef<RTCPeerConnection | null>(null)

  useEffect(() => {
    const socket = ioClient(window.location.origin, { transports: ["websocket", "polling"] })
    socketRef.current = socket
    socket.on("connect", () => {
      setConnected(true)
      socket.emit("bidder:join", {
        name: customerName ?? "Guest",
        bidderId: customerId ?? undefined,
      })
    })
    socket.on("disconnect", () => setConnected(false))
    socket.on("auction:state", (s: AuctionState) => {
      setState(s)
      setFairWarning(s.auction?.fairWarning ?? false)
      setImageIndex(0) // reset image index on lot change
    })
    socket.on("bid:new", () => { setBidFlash(true); setTimeout(() => setBidFlash(false), 800) })
    socket.on("auction:fairWarning", () => setFairWarning(true))
    socket.on("bid:accepted", ({ amount }: { amount: number }) => {
      setBidPending(false)
      setBidFeedback({ ok: true, msg: `✓ Bid of £${amount.toLocaleString("en-GB")} placed — you are now leading!` })
      setTimeout(() => setBidFeedback(null), 4000)
    })
    socket.on("bid:rejected", ({ reason }: { reason: string }) => {
      setBidPending(false)
      setBidFeedback({ ok: false, msg: reason })
      setTimeout(() => setBidFeedback(null), 4000)
    })

    socket.on("bid:commission:accepted", ({ lotNumber, maxAmount }: { lotId: string; lotNumber: string; maxAmount: number }) => {
      setCommissionPending(false)
      setCommissionFeedback({ ok: true, msg: `✓ Commission bid of £${maxAmount.toLocaleString("en-GB")} placed on lot ${lotNumber}` })
      setCommissionAmount("")
      setTimeout(() => { setCommissionFeedback(null); setCommissionModal(null) }, 2500)
    })

    socket.on("bid:commission:rejected", ({ reason }: { reason: string }) => {
      setCommissionPending(false)
      setCommissionFeedback({ ok: false, msg: reason })
      setTimeout(() => setCommissionFeedback(null), 4000)
    })

    // ── WebRTC: stream becomes available ───────────────────────────────────
    async function startViewingStream(broadcasterId: string) {
      // Close any existing connection
      peerConnectionRef.current?.close()

      const pc = new RTCPeerConnection({ iceServers: [{ urls: "stun:stun.l.google.com:19302" }] })
      peerConnectionRef.current = pc

      pc.ontrack = (e) => {
        if (remoteVideoRef.current && e.streams[0]) {
          remoteVideoRef.current.srcObject = e.streams[0]
          setStreamActive(true)
        }
      }

      pc.onicecandidate = (e) => {
        if (e.candidate) socket.emit("webrtc:ice", { targetId: broadcasterId, candidate: e.candidate })
      }

      try {
        const offer = await pc.createOffer({ offerToReceiveVideo: true, offerToReceiveAudio: true })
        await pc.setLocalDescription(offer)
        socket.emit("webrtc:offer", { targetId: broadcasterId, offer })
      } catch (err) {
        console.warn("WebRTC offer error:", err)
      }
    }

    socket.on("webrtc:streamAvailable", ({ broadcasterId }: { broadcasterId: string }) => {
      startViewingStream(broadcasterId)
    })

    socket.on("webrtc:answer", async ({ answer }: { answer: RTCSessionDescriptionInit }) => {
      try {
        await peerConnectionRef.current?.setRemoteDescription(new RTCSessionDescription(answer))
      } catch (err) {
        console.warn("WebRTC answer error:", err)
      }
    })

    socket.on("webrtc:ice", async ({ candidate }: { candidate: RTCIceCandidateInit }) => {
      try {
        await peerConnectionRef.current?.addIceCandidate(new RTCIceCandidate(candidate))
      } catch {}
    })

    socket.on("webrtc:streamEnded", () => {
      peerConnectionRef.current?.close()
      peerConnectionRef.current = null
      if (remoteVideoRef.current) remoteVideoRef.current.srcObject = null
      setStreamActive(false)
    })

    return () => {
      socket.disconnect()
      peerConnectionRef.current?.close()
    }
  }, [])

  // Auto-scroll lot strip to active lot
  useEffect(() => {
    if (!autoScroll || !stripRef.current) return
    const idx = state?.auction?.currentLotIndex ?? initialLotIndex
    const btn = stripRef.current.children[idx] as HTMLElement | undefined
    btn?.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" })
  }, [state?.auction?.currentLotIndex, autoScroll, initialLotIndex])

  const lot = state?.currentLot
  const auction = state?.auction
  const lotIndex = auction?.currentLotIndex ?? initialLotIndex

  // Merge live lot data with static lots for images/title if socket hasn't connected yet
  const staticLot = initialLots[lotIndex] ?? initialLots[0]
  const displayImages = lot?.imageUrls?.length ? lot.imageUrls : staticLot?.imageUrls ?? []
  const displayTitle = lot?.title ?? staticLot?.title ?? "—"
  const displayDesc = lot?.description ?? staticLot?.description ?? ""
  const displayLotNum = lot?.barcode ?? staticLot?.barcode ?? "—"
  const displayImg = displayImages[imageIndex] ?? null

  const currentBid = lot?.currentBid ?? 0
  const askingBid = lot?.askingBid ?? staticLot?.estimateLow ?? 0
  const estimateLow = lot?.estimateLow ?? staticLot?.estimateLow
  const estimateHigh = lot?.estimateHigh ?? staticLot?.estimateHigh

  const lastBid = lot?.bids?.[lot.bids.length - 1]
  const bids = lot?.bids ? [...lot.bids].reverse() : []

  // Is this customer currently the top bidder on the live lot?
  const isLeading = !!(customerId && lastBid?.bidderId === customerId)

  // Lots strip — use socket summary if available, otherwise initial lots
  const stripLots = state?.lots?.length
    ? state.lots
    : initialLots.map(l => ({ id: l.id, barcode: l.barcode, status: l.status, hammerPrice: l.hammerPrice, currentBid: 0 }))

  return (
    <div className="bg-white min-h-screen">

      {/* ── Page header ── */}
      <div className="border-b border-gray-200 px-6 py-4 flex items-center justify-between">
        <div>
          <h1 className="text-[#32348A] font-black text-xl leading-tight">{auctionName}</h1>
          <Link
            href={`/auctions/${auctionCode}`}
            className="text-[#32348A] text-xs font-bold uppercase tracking-widest underline hover:no-underline mt-0.5 inline-block"
          >
            View Catalogue
          </Link>
        </div>
        <div className="flex items-center gap-3">
          {connected ? (
            <>
              <span className="inline-flex items-center gap-1.5 bg-red-600 text-white text-xs font-black px-3 py-1 rounded tracking-widest">
                <span className="w-1.5 h-1.5 bg-white rounded-full animate-ping inline-block" />
                LIVE
              </span>
              {auctionDate && (
                <span className="text-gray-500 text-sm">
                  {format(new Date(auctionDate), "d MMMM yyyy")}
                  <span className="mx-1 text-gray-300">|</span>
                  {format(new Date(auctionDate), "HH:mm")}
                </span>
              )}
            </>
          ) : (
            <span className="text-gray-400 text-sm animate-pulse">Connecting…</span>
          )}
        </div>
      </div>

      {/* ── Pause message overlay ── */}
      {state?.auction?.pauseMessage && (
        <div className="bg-[#32348A] px-6 py-10 flex flex-col items-center justify-center text-center">
          <div className="w-12 h-12 rounded-full bg-white/10 flex items-center justify-center mb-4">
            <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 9v6m4-6v6m7-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <p className="text-white font-black text-2xl uppercase tracking-wide mb-2">Sale Paused</p>
          <p className="text-white/80 text-base">{state.auction.pauseMessage}</p>
          <p className="text-white/40 text-xs mt-4">The auction will resume shortly — please do not leave this page</p>
        </div>
      )}

      {/* ── Fair warning banner ── */}
      {fairWarning && (
        <div className="bg-amber-400 text-amber-900 text-sm font-black text-center py-2.5 tracking-widest animate-pulse">
          ⚠️ FAIR WARNING — SELLING NOW
        </div>
      )}

      {/* ── Main 3-column grid ── */}
      <div className="grid grid-cols-[420px_1fr_340px] border-b border-gray-200" style={{ height: "580px" }}>

        {/* ── COL 1 — Lot image ── */}
        <div className="border-r border-gray-200 flex flex-col overflow-hidden">

          {/* Main image */}
          <div className="relative flex-1 bg-gray-50">
            {displayImg ? (
              <Image
                src={displayImg}
                alt={displayTitle}
                fill
                className="object-contain p-6"
                priority
              />
            ) : (
              <div className="absolute inset-0 flex items-center justify-center">
                <svg className="w-16 h-16 text-gray-200" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                </svg>
              </div>
            )}
          </div>

          {/* Thumbnails + zoom link */}
          <div className="border-t border-gray-100 px-4 py-3 bg-white">
            {displayImages.length > 1 && (
              <div className="flex gap-2 mb-3 overflow-x-auto">
                {displayImages.map((img, i) => (
                  <button
                    key={i}
                    onClick={() => setImageIndex(i)}
                    className={`relative w-14 h-14 shrink-0 border-2 overflow-hidden transition-colors ${
                      i === imageIndex ? "border-[#32348A]" : "border-gray-200 hover:border-gray-400"
                    }`}
                  >
                    <Image src={img} alt="" fill className="object-cover" />
                  </button>
                ))}
              </div>
            )}
            <button className="flex items-center gap-1.5 text-[#32348A] text-xs font-semibold hover:underline uppercase tracking-wide">
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-4.35-4.35M17 11A6 6 0 1 1 5 11a6 6 0 0 1 12 0z" />
              </svg>
              View Zoom/Additional Images
            </button>
          </div>

          {/* Lot no + description accordion */}
          <div className="border-t border-gray-200 px-4 py-3 bg-white">
            <p className="text-[#32348A] text-[10px] font-black uppercase tracking-widest mb-1">LOT {displayLotNum}</p>
            <button
              onClick={() => setDescOpen(v => !v)}
              className="flex items-center justify-between w-full text-left group"
            >
              <span className="text-[#32348A] font-bold text-sm group-hover:underline">Show Full Lot Description</span>
              <svg
                className={`w-4 h-4 text-gray-400 transition-transform ${descOpen ? "rotate-180" : ""}`}
                fill="none" stroke="currentColor" viewBox="0 0 24 24"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </button>
            {descOpen && displayDesc && (
              <p className="text-gray-600 text-sm mt-2 leading-relaxed">{displayDesc}</p>
            )}
          </div>
        </div>

        {/* ── COL 2 — Lot info + bidding ── */}
        <div className="border-r border-gray-200 flex flex-col overflow-y-auto">
          <div className="px-8 py-6 flex flex-col flex-1">

            <p className="text-[#32348A] text-[10px] font-black uppercase tracking-widest mb-2">LOT {displayLotNum}</p>
            <h2 className="text-gray-800 font-semibold text-base leading-snug mb-6">{displayTitle}</h2>

            {/* Estimate */}
            <div className="flex items-center justify-between border-t border-gray-200 py-3.5">
              <span className="text-gray-500 text-xs font-semibold uppercase tracking-widest">Estimate</span>
              <span className="text-gray-700 text-sm font-semibold">
                {fmt(estimateLow)} – {fmt(estimateHigh)}
              </span>
            </div>

            {/* Current bid */}
            <div className="flex items-center justify-between border-t border-gray-200 py-3.5">
              <span className="text-gray-500 text-xs font-semibold uppercase tracking-widest">Current Bid:</span>
              <div className="flex items-center gap-3">
                {lastBid && (
                  <span className="text-gray-400 text-xs uppercase tracking-wide font-medium">
                    {bidTypeLabel(lastBid.type)}
                  </span>
                )}
                <span className={`font-black text-2xl transition-colors duration-300 ${
                  bidFlash ? "text-green-500" : "text-[#32348A]"
                }`}>
                  {fmt(currentBid)}
                </span>
              </div>
            </div>

            {/* Asking bid */}
            <div className="flex items-center justify-between border-t border-b border-gray-200 py-3.5 mb-6">
              <span className="text-gray-500 text-xs font-semibold uppercase tracking-widest">Asking Bid:</span>
              <span className="text-gray-800 font-bold text-base">{fmt(askingBid)}</span>
            </div>

            {/* Leading banner */}
            {isLeading && (
              <div className="border border-green-300 bg-green-50 text-green-700 text-xs font-black text-center py-3 mb-4 tracking-wide uppercase">
                🏆 You Are Currently Winning This Lot
              </div>
            )}

            {/* Bid feedback */}
            {bidFeedback && (
              <div className={`text-sm font-semibold text-center py-2.5 px-3 mb-4 border ${
                bidFeedback.ok
                  ? "bg-green-50 border-green-300 text-green-700"
                  : "bg-red-50 border-red-300 text-red-700"
              }`}>
                {bidFeedback.msg}
              </div>
            )}

            {/* ── BID BUTTON — smart states ── */}
            {!isLoggedIn ? (
              <Link
                href={`/portal/login?redirect=/auctions/${auctionCode}/live`}
                className="block w-full bg-[#32348A] hover:bg-[#28296e] text-white font-black text-center py-4 text-sm tracking-widest uppercase transition-colors mb-3"
              >
                Login to Bid
              </Link>
            ) : !isRegistered ? (
              <div className="mb-3">
                <div className="w-full bg-gray-100 text-gray-400 font-black text-center py-4 text-sm tracking-widest uppercase mb-2 cursor-not-allowed">
                  BID {fmt(askingBid)}
                </div>
                <p className="text-center text-xs text-gray-500">
                  You need to{" "}
                  <Link href={`/auctions/${auctionCode}`} className="text-[#32348A] underline font-semibold">
                    register to bid live
                  </Link>{" "}
                  for this auction
                </p>
              </div>
            ) : isLeading ? (
              <div
                onMouseEnter={() => socketRef.current?.emit("bidder:hoverBid", { hovering: true })}
                onMouseLeave={() => socketRef.current?.emit("bidder:hoverBid", { hovering: false })}
                className="w-full bg-green-600 text-white font-black text-center py-4 text-sm tracking-widest uppercase mb-3 cursor-default"
              >
                🏆 You Are Winning — {fmt(currentBid)}
              </div>
            ) : (
              <button
                type="button"
                disabled={bidPending || !lot || lot.status !== "ACTIVE"}
                onMouseEnter={() => socketRef.current?.emit("bidder:hoverBid", { hovering: true })}
                onMouseLeave={() => socketRef.current?.emit("bidder:hoverBid", { hovering: false })}
                onClick={() => {
                  if (!socketRef.current || !lot) return
                  setBidPending(true)
                  setBidFeedback(null)
                  socketRef.current.emit("bid:place", {
                    amount: askingBid,
                    bidderId: customerId,
                    bidderName: customerName ?? "Online Bidder",
                  })
                }}
                className="block w-full bg-[#32348A] hover:bg-[#28296e] active:scale-[0.98] disabled:opacity-40 disabled:cursor-not-allowed text-white font-black text-center py-4 text-sm tracking-widest uppercase transition-all mb-3"
              >
                {bidPending ? "Placing Bid…" : `BID ${fmt(askingBid)}`}
              </button>
            )}

            {/* Secondary actions */}
            {isLoggedIn && isRegistered && (
              <div className="w-full border border-[#32348A] text-[#32348A] font-bold text-center py-2.5 text-xs tracking-widest uppercase">
                ✓ Approved to Bid Live
              </div>
            )}
            {isLoggedIn && !isRegistered && (
              <Link
                href={`/auctions/${auctionCode}`}
                className="block w-full border border-[#32348A] text-[#32348A] hover:bg-[#32348A] hover:text-white font-bold text-center py-2.5 text-xs tracking-widest uppercase transition-colors"
              >
                Register to Bid Live
              </Link>
            )}

            <div className="mt-auto pt-6 text-center text-xs text-gray-400">
              {state?.onlineCount ?? 0} people watching live
            </div>
          </div>
        </div>

        {/* ── COL 3 — Video + Bid history ── */}
        <div className="flex flex-col overflow-hidden bg-white">

          {/* Video */}
          <div className="relative bg-gray-900 shrink-0" style={{ aspectRatio: "16/9" }}>
            {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
            <video
              ref={remoteVideoRef}
              autoPlay
              playsInline
              className={`w-full h-full object-cover ${streamActive ? "block" : "hidden"}`}
            />
            {!streamActive && (
              <div className="absolute inset-0 flex flex-col items-center justify-center">
                <div className="w-12 h-12 rounded-full bg-white/10 border border-white/30 flex items-center justify-center mb-2">
                  <svg className="w-5 h-5 text-white ml-0.5" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M8 5v14l11-7z"/>
                  </svg>
                </div>
                <p className="text-white/50 text-xs">Waiting for stream…</p>
              </div>
            )}
            <span className="absolute top-2 right-2 bg-red-600 text-white text-[9px] font-black px-2 py-0.5 rounded tracking-widest">
              LIVE
            </span>
          </div>

          {/* Bid history */}
          <div className="flex-1 overflow-y-auto min-h-0">
            <table className="w-full text-xs border-collapse">
              <thead className="bg-gray-50 border-b border-gray-200 sticky top-0 z-10">
                <tr>
                  <th className="text-left px-3 py-2 text-gray-500 font-bold uppercase tracking-wider text-[10px]">
                    LOT NO | TIME
                  </th>
                  <th className="text-right px-3 py-2 text-gray-500 font-bold uppercase tracking-wider text-[10px]">
                    BID AMOUNT
                  </th>
                  <th className="text-right px-3 py-2 text-gray-500 font-bold uppercase tracking-wider text-[10px]">
                    BID TYPE
                  </th>
                </tr>
              </thead>
              <tbody>
                {bids.length === 0 ? (
                  <tr>
                    <td colSpan={3} className="text-center text-gray-400 py-8 text-xs">No bids yet</td>
                  </tr>
                ) : (
                  bids.map((b, i) => (
                    <tr
                      key={i}
                      className={`border-b border-gray-100 ${
                        i === 0 ? "bg-[#eef2f9]" : i % 2 === 0 ? "bg-white" : "bg-gray-50/50"
                      } hover:bg-blue-50/30`}
                    >
                      <td className="px-3 py-2.5">
                        <span className="text-[#32348A] font-bold text-[11px]">LOT {displayLotNum}</span>
                        <span className="text-gray-400 text-[10px] ml-1">| {fmtTime(b.timestamp)}</span>
                      </td>
                      <td className="px-3 py-2.5 text-right font-bold text-gray-800">{fmt(b.amount)}</td>
                      <td className="px-3 py-2.5 text-right text-gray-500 text-[10px]">{bidTypeLabel(b.type)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* ── Lot strip ── */}
      <div className="bg-white border-b border-gray-200 px-4 pt-3 pb-4">
        <div className="flex items-center justify-between mb-3">
          <p className="text-gray-500 text-xs font-semibold uppercase tracking-widest">All Lots</p>
          <label className="flex items-center gap-2 cursor-pointer text-xs text-gray-500 select-none">
            <div
              onClick={() => setAutoScroll(v => !v)}
              className={`relative w-9 h-5 rounded-full transition-colors ${autoScroll ? "bg-[#32348A]" : "bg-gray-300"}`}
            >
              <div className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${autoScroll ? "translate-x-4" : "translate-x-0.5"}`} />
            </div>
            {autoScroll ? "Auto Scroll On" : "Auto Scroll Off"}
          </label>
        </div>

        <div ref={stripRef} className="flex gap-2 overflow-x-auto pb-1">
          {stripLots.map((l, i) => {
            const staticL = initialLots.find(il => il.id === l.id)
            const thumb = staticL?.imageUrls[0] ?? null
            const isActive = i === lotIndex
            const isSold = l.status === "SOLD"
            const isPassed = l.status === "PASSED" || l.status === "WITHDRAWN"
            const isClickable = !isSold && !isPassed && isLoggedIn && isRegistered

            return (
              <div
                key={l.id}
                onClick={() => {
                  if (!isClickable) return
                  setCommissionModal({
                    lotId: l.id,
                    barcode: l.barcode,
                    title: staticL?.title ?? l.barcode,
                    estimateLow: staticL?.estimateLow ?? null,
                    estimateHigh: staticL?.estimateHigh ?? null,
                    imageUrl: thumb,
                    status: l.status,
                  })
                  setCommissionAmount("")
                  setCommissionFeedback(null)
                }}
                className={`shrink-0 w-36 border-2 overflow-hidden transition-all ${
                  isActive
                    ? "border-[#32348A] shadow-md"
                    : isSold
                    ? "border-green-400 opacity-80"
                    : isPassed
                    ? "border-red-300 opacity-70"
                    : isClickable
                    ? "border-gray-200 hover:border-[#32348A] cursor-pointer"
                    : "border-gray-200"
                }`}
              >
                <div className="relative bg-gray-100" style={{ aspectRatio: "4/3" }}>
                  {thumb ? (
                    <Image src={thumb} alt="" fill className="object-cover" />
                  ) : (
                    <div className="absolute inset-0 bg-gray-100" />
                  )}
                  {isSold && (
                    <div className="absolute inset-0 bg-black/50 flex items-center justify-center">
                      <div className="text-center">
                        <p className="text-white text-[9px] font-black uppercase">SOLD</p>
                        <p className="text-green-300 text-[10px] font-black">{fmt(l.hammerPrice)}</p>
                      </div>
                    </div>
                  )}
                  {isPassed && (
                    <div className="absolute inset-0 bg-black/40 flex items-center justify-center">
                      <span className="text-white text-[9px] font-black uppercase">PASSED</span>
                    </div>
                  )}
                  {isActive && (
                    <div className="absolute top-1 left-1">
                      <span className="bg-[#32348A] text-white text-[8px] font-black px-1.5 py-0.5 rounded tracking-wider">NOW</span>
                    </div>
                  )}
                </div>
                <div className="px-2 py-1.5 bg-white">
                  <p className="text-[#32348A] text-[9px] font-black uppercase tracking-wide">LOT {l.barcode ?? "—"}</p>
                  <p className="text-gray-500 text-[9px] leading-tight line-clamp-2">{staticL?.title ?? ""}</p>
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* ── Commission bid modal ── */}
      {commissionModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4"
          onClick={(e) => { if (e.target === e.currentTarget) { setCommissionModal(null); setCommissionFeedback(null) } }}
        >
          <div className="bg-white w-full max-w-lg shadow-2xl">

            {/* Modal header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200">
              <p className="text-[#32348A] text-xs font-black uppercase tracking-widest">
                LOT {commissionModal.barcode}
              </p>
              <button
                onClick={() => { setCommissionModal(null); setCommissionFeedback(null) }}
                className="text-gray-400 hover:text-gray-600 transition-colors"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* Lot info */}
            <div className="flex gap-4 px-5 pt-4 pb-3">
              {commissionModal.imageUrl && (
                <div className="relative w-20 h-20 shrink-0 bg-gray-50 border border-gray-100">
                  <Image src={commissionModal.imageUrl} alt="" fill className="object-contain p-1" />
                </div>
              )}
              <div className="flex-1 min-w-0">
                <p className="text-gray-800 font-semibold text-sm leading-snug line-clamp-3">
                  {commissionModal.title}
                </p>
                {(commissionModal.estimateLow || commissionModal.estimateHigh) && (
                  <p className="text-gray-500 text-xs mt-1">
                    Estimate: {fmt(commissionModal.estimateLow)} – {fmt(commissionModal.estimateHigh)}
                  </p>
                )}
              </div>
            </div>

            {/* Bid input */}
            <div className="px-5 pb-5">
              <p className="text-gray-700 text-sm font-semibold mb-3">Type your auto bid:</p>

              {/* Feedback */}
              {commissionFeedback && (
                <div className={`text-sm font-semibold text-center py-2.5 px-3 mb-3 border ${
                  commissionFeedback.ok
                    ? "bg-green-50 border-green-300 text-green-700"
                    : "bg-red-50 border-red-300 text-red-700"
                }`}>
                  {commissionFeedback.msg}
                </div>
              )}

              <div className="flex gap-0">
                <span className="inline-flex items-center px-3 bg-gray-100 border border-r-0 border-gray-300 text-gray-500 text-sm font-semibold">
                  £
                </span>
                <input
                  type="number"
                  min={1}
                  step={1}
                  value={commissionAmount}
                  onChange={e => setCommissionAmount(e.target.value)}
                  onKeyDown={e => { if (e.key === "Enter") document.getElementById("commission-place-btn")?.click() }}
                  placeholder="Type your bid..."
                  className="flex-1 border border-gray-300 px-3 py-3 text-sm focus:outline-none focus:border-[#32348A] focus:ring-1 focus:ring-[#32348A]"
                />
                <button
                  id="commission-place-btn"
                  disabled={commissionPending || !commissionAmount || Number(commissionAmount) <= 0}
                  onClick={() => {
                    if (!socketRef.current || !commissionAmount) return
                    setCommissionPending(true)
                    setCommissionFeedback(null)
                    socketRef.current.emit("bid:commission", {
                      lotId: commissionModal.lotId,
                      maxAmount: Number(commissionAmount),
                      bidderId: customerId,
                      bidderName: customerName ?? "Online Bidder",
                    })
                  }}
                  className="bg-green-600 hover:bg-green-700 disabled:opacity-40 disabled:cursor-not-allowed text-white font-black px-6 py-3 text-sm tracking-widest uppercase transition-colors"
                >
                  {commissionPending ? "…" : "PLACE"}
                </button>
              </div>
              <p className="text-gray-400 text-xs mt-2">
                We will bid on your behalf up to your maximum. Your bid stays confidential.
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
