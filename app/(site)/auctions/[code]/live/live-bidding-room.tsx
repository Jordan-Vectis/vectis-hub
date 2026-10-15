"use client"

import { useEffect, useRef, useState } from "react"
import { io as ioClient, Socket } from "socket.io-client"
import Image from "next/image"
import Link from "next/link"
import { saleDateLong } from "../../../site-dates"

// The live bidding room on the test website, skinned to the site's look (2026-10-14): the lot's
// pictures on the left, the bidding in the middle, the stream and the bid history on the right,
// then the strip of every lot along the bottom. The three columns sit side by side from lg and
// stack on a phone. The socket and WebRTC code is the room's logic and is left exactly as it was.

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

// A row's label in the bidding column — small navy caps, as the real site labels them.
const ROW_LABEL = "vs-caps text-xs text-[var(--vs-muted)]"
// A notice box: navy for good news, red for a refusal.
const NOTICE_OK = "border border-[var(--vs-navy)] bg-white text-[var(--vs-navy)]"
const NOTICE_BAD = "border border-[var(--vs-red)] bg-white text-[var(--vs-red)]"

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
      <div className="border-b border-[var(--vs-line)] px-4 sm:px-6 py-4 flex flex-wrap items-center justify-between gap-x-6 gap-y-2">
        <div className="min-w-0">
          <h1 className="vs-h3 leading-tight">{auctionName}</h1>
          <Link href={`/auctions/${auctionCode}`} className="vs-link vs-link-sm mt-1">
            View catalogue
          </Link>
        </div>
        <div className="flex items-center gap-3">
          {connected ? (
            <>
              <span className="vs-badge vs-badge-red text-xs !px-3 inline-flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 bg-white rounded-full animate-ping inline-block" aria-hidden="true" />
                Live
              </span>
              {auctionDate && (
                <span className="text-sm text-[var(--vs-muted)]">{saleDateLong(new Date(auctionDate))}</span>
              )}
            </>
          ) : (
            <span className="text-sm text-[var(--vs-muted)] animate-pulse">Connecting…</span>
          )}
        </div>
      </div>

      {/* ── Pause message overlay ── */}
      {state?.auction?.pauseMessage && (
        <div className="bg-[var(--vs-navy)] px-6 py-10 flex flex-col items-center justify-center text-center">
          <div className="w-12 h-12 rounded-full bg-white/10 flex items-center justify-center mb-4">
            <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 9v6m4-6v6m7-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <p className="vs-h2 !text-white mb-2">Sale paused</p>
          <p className="text-white/85 text-base">{state.auction.pauseMessage}</p>
          <p className="text-white/60 text-xs mt-4">The auction will resume shortly — please do not leave this page</p>
        </div>
      )}

      {/* ── Fair warning banner ── */}
      {fairWarning && (
        <div className="bg-[var(--vs-red)] text-white vs-caps text-center py-2.5 animate-pulse" role="status">
          Fair warning — selling now
        </div>
      )}

      {/* ── Main grid: three columns from lg, one under it ── */}
      <div className="grid grid-cols-1 lg:grid-cols-[380px_1fr_320px] xl:grid-cols-[420px_1fr_340px] lg:h-[580px] border-b border-[var(--vs-line)]">

        {/* ── COL 1 — Lot image ── */}
        <div className="border-b lg:border-b-0 lg:border-r border-[var(--vs-line)] flex flex-col lg:overflow-hidden">

          {/* Main image */}
          <div className="relative bg-white min-h-[300px] sm:min-h-[380px] lg:min-h-0 lg:flex-1">
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
                <svg className="w-16 h-16 text-[var(--vs-line)]" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                </svg>
              </div>
            )}
          </div>

          {/* Thumbnails */}
          {displayImages.length > 1 && (
            <div className="border-t border-[var(--vs-line)] px-4 py-3 bg-white">
              <div className="flex gap-2 overflow-x-auto" aria-label="More photos of this lot">
                {displayImages.map((img, i) => (
                  <button
                    key={i}
                    type="button"
                    onClick={() => setImageIndex(i)}
                    aria-label={`Photo ${i + 1}`}
                    aria-current={i === imageIndex ? "true" : undefined}
                    className={`relative w-14 h-14 shrink-0 border-2 overflow-hidden transition-colors ${
                      i === imageIndex ? "border-[var(--vs-navy)]" : "border-[var(--vs-line)] hover:border-[var(--vs-muted)]"
                    }`}
                  >
                    <Image src={img} alt="" fill className="object-cover" />
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Lot no + description accordion */}
          <div className="border-t border-[var(--vs-line)] px-4 py-3 bg-white">
            <p className="vs-caps text-[var(--vs-navy)] mb-1">Lot {displayLotNum}</p>
            <button
              type="button"
              onClick={() => setDescOpen(v => !v)}
              aria-expanded={descOpen}
              className="flex items-center justify-between w-full min-h-[44px] text-left group"
            >
              <span className="text-sm font-medium text-[var(--vs-navy)] group-hover:underline">Show full lot description</span>
              <svg
                className={`w-4 h-4 shrink-0 text-[var(--vs-navy)] transition-transform ${descOpen ? "rotate-180" : ""}`}
                fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </button>
            {descOpen && displayDesc && (
              <p className="text-sm mt-2 leading-relaxed whitespace-pre-line lg:max-h-40 lg:overflow-y-auto">{displayDesc}</p>
            )}
          </div>
        </div>

        {/* ── COL 2 — Lot info + bidding ── */}
        <div className="border-b lg:border-b-0 lg:border-r border-[var(--vs-line)] flex flex-col lg:overflow-y-auto">
          <div className="px-5 sm:px-8 py-6 flex flex-col flex-1">

            <p className="vs-caps text-[var(--vs-navy)] mb-2">Lot {displayLotNum}</p>
            <h2 className="vs-h4 leading-snug mb-6">{displayTitle}</h2>

            {/* Estimate */}
            <div className="flex items-center justify-between gap-4 border-t border-[var(--vs-line)] py-3.5">
              <span className={ROW_LABEL}>Estimate</span>
              <span className="text-sm font-medium">
                {fmt(estimateLow)} – {fmt(estimateHigh)}
              </span>
            </div>

            {/* Current bid */}
            <div className="flex items-center justify-between gap-4 border-t border-[var(--vs-line)] py-3.5">
              <span className={ROW_LABEL}>Current bid</span>
              <div className="flex items-center gap-3">
                {lastBid && (
                  <span className="vs-caps text-xs text-[var(--vs-muted)]">
                    {bidTypeLabel(lastBid.type)}
                  </span>
                )}
                <span className={`text-2xl font-semibold transition-colors duration-300 ${
                  bidFlash ? "text-[var(--vs-red)]" : "text-[var(--vs-navy)]"
                }`}>
                  {fmt(currentBid)}
                </span>
              </div>
            </div>

            {/* Asking bid */}
            <div className="flex items-center justify-between gap-4 border-t border-b border-[var(--vs-line)] py-3.5 mb-6">
              <span className={ROW_LABEL}>Asking bid</span>
              <span className="vs-price">{fmt(askingBid)}</span>
            </div>

            {/* Leading banner */}
            {isLeading && (
              <div className="border border-[var(--vs-navy)] bg-[var(--vs-bg)] text-[var(--vs-navy)] vs-caps text-xs text-center py-3 mb-4" role="status">
                You are currently winning this lot
              </div>
            )}

            {/* Bid feedback */}
            {bidFeedback && (
              <div className={`text-sm text-center py-2.5 px-3 mb-4 ${bidFeedback.ok ? NOTICE_OK : NOTICE_BAD}`} role="status">
                {bidFeedback.msg}
              </div>
            )}

            {/* ── BID BUTTON — smart states ── */}
            {!isLoggedIn ? (
              <Link
                href={`/portal/login?redirect=/auctions/${auctionCode}/live`}
                className="vs-btn vs-btn-block vs-btn-lg mb-3"
              >
                Login to bid
              </Link>
            ) : !isRegistered ? (
              <div className="mb-3">
                <div className="vs-btn vs-btn-block vs-btn-lg mb-2 cursor-not-allowed" aria-disabled="true">
                  Bid {fmt(askingBid)}
                </div>
                <p className="text-center text-xs text-[var(--vs-muted)]">
                  You need to{" "}
                  <Link href={`/auctions/${auctionCode}`} className="vs-text-link">
                    register to bid live
                  </Link>{" "}
                  for this auction
                </p>
              </div>
            ) : isLeading ? (
              <div
                onMouseEnter={() => socketRef.current?.emit("bidder:hoverBid", { hovering: true })}
                onMouseLeave={() => socketRef.current?.emit("bidder:hoverBid", { hovering: false })}
                className="w-full border border-[var(--vs-navy)] bg-[var(--vs-bg)] text-[var(--vs-navy)] vs-caps text-center py-4 mb-3 cursor-default"
              >
                You are winning — {fmt(currentBid)}
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
                className="vs-btn vs-btn-block vs-btn-lg mb-3 active:scale-[0.98] transition-all"
              >
                {bidPending ? "Placing bid…" : `Bid ${fmt(askingBid)}`}
              </button>
            )}

            {/* Secondary actions */}
            {isLoggedIn && isRegistered && (
              <div className="w-full border border-[var(--vs-navy)] text-[var(--vs-navy)] vs-caps text-xs text-center py-2.5">
                Approved to bid live
              </div>
            )}
            {isLoggedIn && !isRegistered && (
              <Link
                href={`/auctions/${auctionCode}`}
                className="vs-btn vs-btn-outline vs-btn-block vs-btn-sm"
              >
                Register to bid live
              </Link>
            )}

            <div className="mt-auto pt-6 text-center text-xs text-[var(--vs-muted)]">
              {state?.onlineCount ?? 0} people watching live
            </div>
          </div>
        </div>

        {/* ── COL 3 — Video + Bid history ── */}
        <div className="flex flex-col lg:overflow-hidden bg-white">

          {/* Video */}
          <div className="relative bg-black shrink-0 aspect-video">
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
                  <svg className="w-5 h-5 text-white ml-0.5" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M8 5v14l11-7z"/>
                  </svg>
                </div>
                <p className="text-white/60 text-xs">Waiting for stream…</p>
              </div>
            )}
            <span className="vs-badge vs-badge-red absolute top-2 right-2 text-xs !px-2 !py-0.5">
              Live
            </span>
          </div>

          {/* Bid history */}
          <div className="flex-1 overflow-y-auto min-h-0 max-h-[320px] lg:max-h-none">
            <table className="w-full text-sm border-collapse">
              <thead className="vs-band border-b border-[var(--vs-line)] sticky top-0 z-10">
                <tr>
                  <th scope="col" className="text-left px-3 py-2 vs-caps text-xs text-[var(--vs-muted)] font-medium">
                    Lot no | Time
                  </th>
                  <th scope="col" className="text-right px-3 py-2 vs-caps text-xs text-[var(--vs-muted)] font-medium">
                    Bid amount
                  </th>
                  <th scope="col" className="text-right px-3 py-2 vs-caps text-xs text-[var(--vs-muted)] font-medium">
                    Bid type
                  </th>
                </tr>
              </thead>
              <tbody>
                {bids.length === 0 ? (
                  <tr>
                    <td colSpan={3} className="text-center text-[var(--vs-muted)] py-8 text-sm">No bids yet</td>
                  </tr>
                ) : (
                  bids.map((b, i) => (
                    <tr
                      key={i}
                      className={`border-b border-[var(--vs-line)] ${i === 0 ? "bg-[var(--vs-bg)]" : "bg-white"}`}
                    >
                      <td className="px-3 py-2.5 whitespace-nowrap">
                        <span className="text-[var(--vs-navy)] font-medium text-xs uppercase">Lot {displayLotNum}</span>
                        <span className="text-[var(--vs-muted)] text-xs ml-1">| {fmtTime(b.timestamp)}</span>
                      </td>
                      <td className="px-3 py-2.5 text-right vs-price">{fmt(b.amount)}</td>
                      <td className="px-3 py-2.5 text-right text-[var(--vs-muted)] text-xs">{bidTypeLabel(b.type)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* ── Lot strip ── */}
      <div className="bg-white border-b border-[var(--vs-line)] px-4 sm:px-6 pt-3 pb-4">
        <div className="flex items-center justify-between gap-4 mb-2">
          <p className="vs-caps text-xs text-[var(--vs-muted)]">All lots</p>
          <label className="flex items-center gap-2 cursor-pointer text-xs text-[var(--vs-muted)] select-none min-h-[44px]">
            <div
              onClick={() => setAutoScroll(v => !v)}
              className={`relative w-9 h-5 rounded-full transition-colors ${autoScroll ? "bg-[var(--vs-navy)]" : "bg-[var(--vs-line)]"}`}
            >
              <div className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${autoScroll ? "translate-x-4" : "translate-x-0.5"}`} />
            </div>
            {autoScroll ? "Auto scroll on" : "Auto scroll off"}
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
                className={`shrink-0 w-32 sm:w-36 border-2 overflow-hidden transition-all ${
                  isActive
                    ? "border-[var(--vs-navy)] shadow-[var(--vs-shadow)]"
                    : isSold
                    ? "border-[var(--vs-muted)] opacity-80"
                    : isPassed
                    ? "border-[var(--vs-line)] opacity-60"
                    : isClickable
                    ? "border-[var(--vs-line)] hover:border-[var(--vs-navy)] cursor-pointer"
                    : "border-[var(--vs-line)]"
                }`}
              >
                <div className="relative bg-[var(--vs-bg)] aspect-[4/3]">
                  {thumb ? (
                    <Image src={thumb} alt="" fill className="object-cover" />
                  ) : (
                    <div className="absolute inset-0 bg-[var(--vs-bg)]" />
                  )}
                  {isSold && (
                    <div className="absolute inset-0 bg-black/50 flex items-center justify-center">
                      <div className="text-center">
                        <p className="text-white vs-caps text-xs">Sold</p>
                        <p className="text-white text-xs font-semibold">{fmt(l.hammerPrice)}</p>
                      </div>
                    </div>
                  )}
                  {isPassed && (
                    <div className="absolute inset-0 bg-black/40 flex items-center justify-center">
                      <span className="text-white vs-caps text-xs">Passed</span>
                    </div>
                  )}
                  {isActive && (
                    <div className="absolute top-1 left-1">
                      <span className="vs-badge text-xs !px-1.5 !py-0.5">Now</span>
                    </div>
                  )}
                </div>
                <div className="px-2 py-1.5 bg-white">
                  <p className="vs-caps text-xs text-[var(--vs-navy)] truncate">Lot {l.barcode ?? "—"}</p>
                  <p className="text-xs text-[var(--vs-muted)] leading-tight line-clamp-2">{staticL?.title ?? ""}</p>
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
          <div className="vs-card w-full max-w-lg" role="dialog" aria-modal="true" aria-label={`Commission bid on lot ${commissionModal.barcode}`}>

            {/* Modal header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--vs-line)]">
              <p className="vs-caps text-[var(--vs-navy)]">
                Lot {commissionModal.barcode}
              </p>
              <button
                type="button"
                onClick={() => { setCommissionModal(null); setCommissionFeedback(null) }}
                aria-label="Close"
                className="vs-arrow !border-0"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* Lot info */}
            <div className="flex gap-4 px-5 pt-4 pb-3">
              {commissionModal.imageUrl && (
                <div className="relative w-20 h-20 shrink-0 bg-white border border-[var(--vs-line)]">
                  <Image src={commissionModal.imageUrl} alt="" fill className="object-contain p-1" />
                </div>
              )}
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium leading-snug line-clamp-3">
                  {commissionModal.title}
                </p>
                {(commissionModal.estimateLow || commissionModal.estimateHigh) && (
                  <p className="text-xs text-[var(--vs-muted)] mt-1">
                    Estimate: {fmt(commissionModal.estimateLow)} – {fmt(commissionModal.estimateHigh)}
                  </p>
                )}
              </div>
            </div>

            {/* Bid input */}
            <div className="px-5 pb-5">
              <p className="vs-label">Type your auto bid</p>

              {/* Feedback */}
              {commissionFeedback && (
                <div className={`text-sm text-center py-2.5 px-3 mb-3 ${commissionFeedback.ok ? NOTICE_OK : NOTICE_BAD}`} role="status">
                  {commissionFeedback.msg}
                </div>
              )}

              <div className="flex items-stretch">
                <span className="inline-flex items-center px-3 vs-band border border-r-0 border-[var(--vs-line)] text-[var(--vs-muted)] text-sm">
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
                  aria-label="Your maximum bid in pounds"
                  className="vs-input flex-1 min-w-0"
                />
                <button
                  id="commission-place-btn"
                  type="button"
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
                  className="vs-btn shrink-0"
                >
                  {commissionPending ? "…" : "Place"}
                </button>
              </div>
              <p className="text-xs text-[var(--vs-muted)] mt-2">
                We will bid on your behalf up to your maximum. Your bid stays confidential.
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
