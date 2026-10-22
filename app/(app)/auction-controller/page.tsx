"use client"

import { useEffect, useRef, useState, useCallback } from "react"
import { io as ioClient, Socket } from "socket.io-client"
import { lotPhotoUrl } from "@/lib/photo-url"
import { showError } from "@/lib/error-modal"

// ─── Types ────────────────────────────────────────────────────────────────────
interface AuctionMeta {
  id: string
  name: string
  code: string
  auctionDate: string | null
  lotCount: number
  published: boolean
  finished: boolean
  complete: boolean
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
}

interface BidEntry {
  amount: number
  type: string
  bidderId?: string
  bidderName?: string
  timestamp: string
}

interface LotSummary {
  id: string
  lotNumber: string
  title: string
  status: string
  hammerPrice: number | null
  currentBid: number
}

interface AuctionState {
  auction: {
    id: string
    title: string
    code: string
    status: string
    currentLotIndex: number
    fairWarning: boolean
    pauseMessage: string | null
    totalLots: number
  } | null
  currentLot: LiveLot | null
  lots: LotSummary[]
  onlineCount: number
}

// ─── Helpers ─────────────────────────────────────────────────────────────────
function fmt(n: number | null | undefined) {
  if (!n && n !== 0) return "—"
  return `£${n.toLocaleString()}`
}

// ─── Component ────────────────────────────────────────────────────────────────
export default function AuctionControllerPage() {
  const socketRef = useRef<Socket | null>(null)

  const [phase, setPhase] = useState<"login" | "select" | "control">("login")
  const [loginError, setLoginError] = useState("")

  const [auctions, setAuctions] = useState<AuctionMeta[]>([])
  const [state, setState] = useState<AuctionState>({
    auction: null, currentLot: null, lots: [], onlineCount: 0,
  })
  const [recentResults, setRecentResults] = useState<{ lotNumber: string; hammerPrice: number; title: string }[]>([])

  const [askingInput, setAskingInput]     = useState("")
  const [incrementInput, setIncrementInput] = useState("")
  const [autoBidBidder, setAutoBidBidder] = useState("")
  const [autoBidMax, setAutoBidMax]       = useState("")

  const [onlineBidAlert, setOnlineBidAlert] = useState<{ bidderId: string; bidderName: string; amount: number } | null>(null)
  const [fairWarningFlash, setFairWarningFlash] = useState(false)
  const [hammerFlash, setHammerFlash] = useState(false)
  const [soldPopup, setSoldPopup] = useState<{ lotNumber: string; title: string; hammerPrice: number } | null>(null)
  const [soldCountdown, setSoldCountdown] = useState(3)

  // ── Camera / WebRTC state ─────────────────────────────────────────────────
  const [isBroadcasting, setIsBroadcasting] = useState(false)
  const [cameraError, setCameraError] = useState<string | null>(null)
  const localVideoRef = useRef<HTMLVideoElement>(null)
  const localStreamRef = useRef<MediaStream | null>(null)
  const peerConnectionsRef = useRef<Map<string, RTCPeerConnection>>(new Map())

  // ── Pause message state ────────────────────────────────────────────────────
  const [pauseMessageInput, setPauseMessageInput] = useState("")
  const [activePauseMessage, setActivePauseMessage] = useState<string | null>(null)

  // ── Socket setup ─────────────────────────────────────────────────────────
  useEffect(() => {
    const socket = ioClient(window.location.origin, { transports: ["websocket", "polling"] })
    socketRef.current = socket

    socket.on("clerk:auth:ok", () => {
      setPhase(p => (p === "login" ? "select" : p)) // a reconnect mid-sale stays where it is
      socket.emit("clerk:loadAuctions")
    })
    socket.on("clerk:auth:fail", (e: { message?: string }) => setLoginError(e?.message || "You don't have access to the clerk controls."))
    // Access comes from the Hub login — ask on every (re)connect, so a dropped connection keeps the controls.
    socket.on("connect", () => socket.emit("clerk:auth"))
    socket.on("clerk:auctions",  (list: AuctionMeta[]) => setAuctions(list))
    socket.on("clerk:auctionLoaded", () => setPhase("control"))
    socket.on("clerk:error", (e: { message: string }) => showError("Auction controller error", e.message))

    socket.on("auction:state", (s: AuctionState) => {
      setState(s)
      setFairWarningFlash(s.auction?.fairWarning ?? false)
      setActivePauseMessage(s.auction?.pauseMessage ?? null)
    })

    socket.on("lot:hammer", (d: { lotNumber: string; hammerPrice: number; title?: string }) => {
      setHammerFlash(true)
      setTimeout(() => setHammerFlash(false), 1200)
      // Show sold popup with 3-second countdown matching server auto-advance
      setSoldPopup({ lotNumber: d.lotNumber, title: d.title ?? "", hammerPrice: d.hammerPrice })
      setSoldCountdown(3)
      let count = 3
      const interval = setInterval(() => {
        count--
        setSoldCountdown(count)
        if (count <= 0) {
          clearInterval(interval)
          setSoldPopup(null)
        }
      }, 1000)
    })

    socket.on("auction:fairWarning", () => {
      setFairWarningFlash(true)
    })

    socket.on("bid:online", (d: { bidderId: string; bidderName: string; amount: number }) => {
      setOnlineBidAlert(d)
    })

    // ── WebRTC: a viewer is sending us an offer ───────────────────────────
    socket.on("webrtc:offer", async (d: { offer: RTCSessionDescriptionInit; from: string }) => {
      if (!localStreamRef.current) return
      const pc = new RTCPeerConnection({ iceServers: [{ urls: "stun:stun.l.google.com:19302" }] })
      peerConnectionsRef.current.set(d.from, pc)

      localStreamRef.current.getTracks().forEach(track =>
        pc.addTrack(track, localStreamRef.current!)
      )

      pc.onicecandidate = e => {
        if (e.candidate) socket.emit("webrtc:ice", { targetId: d.from, candidate: e.candidate })
      }

      try {
        await pc.setRemoteDescription(new RTCSessionDescription(d.offer))
        const answer = await pc.createAnswer()
        await pc.setLocalDescription(answer)
        socket.emit("webrtc:answer", { targetId: d.from, answer })
      } catch (err) {
        console.warn("WebRTC offer handling error:", err)
      }
    })

    // ── WebRTC: incoming ICE candidate from a viewer ──────────────────────
    socket.on("webrtc:ice", (d: { candidate: RTCIceCandidateInit; from: string }) => {
      const pc = peerConnectionsRef.current.get(d.from)
      if (pc) pc.addIceCandidate(new RTCIceCandidate(d.candidate)).catch(() => {})
    })

    return () => {
      socket.disconnect()
      // Clean up any active stream on unmount
      localStreamRef.current?.getTracks().forEach(t => t.stop())
      peerConnectionsRef.current.forEach(pc => pc.close())
    }
  }, [])

  // Keep recent results list updated
  useEffect(() => {
    if (!state.lots) return
    const sold = state.lots
      .filter(l => l.status === "SOLD" && l.hammerPrice)
      .slice(-10)
      .reverse()
      .map(l => ({ lotNumber: l.lotNumber, hammerPrice: l.hammerPrice!, title: l.title }))
    setRecentResults(sold)
  }, [state.lots])

  const emit = useCallback((ev: string, data?: object) => {
    socketRef.current?.emit(ev, data)
  }, [])

  // ── Login screen ──────────────────────────────────────────────────────────
  if (phase === "login") {
    return (
      <div className="flex items-center justify-center min-h-screen bg-[#0d1117]">
        <div className="bg-[#161b2e] border border-white/10 rounded-2xl p-10 w-96 shadow-2xl text-center">
          <div className="text-4xl mb-3">🔨</div>
          <h1 className="text-white text-xl font-extrabold mb-1">Clerking Controller</h1>
          {loginError ? (
            <>
              <p className="text-red-400 text-sm mb-6">{loginError}</p>
              <button
                onClick={() => { setLoginError(""); emit("clerk:auth") }}
                className="w-full min-h-11 bg-blue-600 hover:bg-blue-500 text-white font-bold py-2.5 rounded-lg transition-colors"
              >
                Try again
              </button>
            </>
          ) : (
            <p className="text-slate-400 text-sm">Checking your Hub access…</p>
          )}
        </div>
      </div>
    )
  }

  // ── Auction selector ──────────────────────────────────────────────────────
  if (phase === "select") {
    return (
      <div className="min-h-screen bg-[#0d1117] p-6">
        <div className="max-w-5xl mx-auto">
          <div className="mb-6">
            <h2 className="text-white font-extrabold text-xl">🔨 Auction Control Centre</h2>
            <p className="text-slate-500 text-sm mt-1">Select an auction to operate or view</p>
          </div>

          {/* Column headers */}
          <div className="grid grid-cols-[1fr_180px_90px_auto] gap-4 px-4 mb-2">
            <span className="text-slate-500 text-xs font-bold uppercase tracking-wider">Auction Name</span>
            <span className="text-slate-500 text-xs font-bold uppercase tracking-wider">Date/Time</span>
            <span className="text-slate-500 text-xs font-bold uppercase tracking-wider">Lots</span>
            <span className="text-slate-500 text-xs font-bold uppercase tracking-wider">Controls</span>
          </div>

          <div className="flex flex-col gap-2">
            {auctions.length === 0 && (
              <p className="text-center text-slate-500 py-8 text-sm">No auctions found</p>
            )}
            {auctions.map(a => (
              <div
                key={a.id}
                className="bg-[#161b2e] border border-white/10 rounded-xl p-4 grid grid-cols-[1fr_180px_90px_auto] gap-4 items-center"
              >
                <div>
                  <div className="text-white font-bold text-sm">{a.name}</div>
                  <div className="text-slate-500 text-xs mt-0.5">{a.code}</div>
                </div>
                <div className="text-slate-400 text-xs">
                  {a.auctionDate
                    ? new Date(a.auctionDate).toLocaleDateString("en-GB", { day: "2-digit", month: "2-digit", year: "numeric" }) +
                      " " + new Date(a.auctionDate).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })
                    : "No date"}
                </div>
                <div className="text-slate-400 text-xs">{a.lotCount} Lots</div>

                {/* Action buttons */}
                <div className="flex flex-wrap gap-1.5">
                  <button
                    onClick={() => emit("clerk:selectAuction", { auctionId: a.id })}
                    className="bg-green-600 hover:bg-green-500 text-white text-xs font-bold px-3 py-1.5 rounded-lg transition-colors"
                  >
                    Operate
                  </button>
                  <button
                    onClick={() => window.open(`/auction-controller/auctioneer`, "_blank")}
                    className="bg-slate-600 hover:bg-slate-500 text-white text-xs font-bold px-3 py-1.5 rounded-lg transition-colors"
                  >
                    Auctioneer
                  </button>
                  <button
                    onClick={() => window.open(`/auction-controller/results`, "_blank")}
                    className="bg-blue-700 hover:bg-blue-600 text-white text-xs font-bold px-3 py-1.5 rounded-lg transition-colors"
                  >
                    Results
                  </button>
                </div>
              </div>
            ))}
          </div>

          <p className="text-slate-600 text-xs mt-4">
            Tip: Open Auctioneer and Results screens on separate monitors before pressing Operate.
          </p>
        </div>
      </div>
    )
  }

  // ── Camera stream functions ───────────────────────────────────────────────
  async function startBroadcast() {
    setCameraError(null)
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true })
      localStreamRef.current = stream
      if (localVideoRef.current) localVideoRef.current.srcObject = stream
      setIsBroadcasting(true)
      emit("webrtc:ready")
    } catch {
      setCameraError("Could not access camera — check browser permissions.")
    }
  }

  function stopBroadcast() {
    localStreamRef.current?.getTracks().forEach(t => t.stop())
    localStreamRef.current = null
    if (localVideoRef.current) localVideoRef.current.srcObject = null
    peerConnectionsRef.current.forEach(pc => pc.close())
    peerConnectionsRef.current.clear()
    setIsBroadcasting(false)
    emit("webrtc:stop")
  }

  // ── Main clerk control panel ───────────────────────────────────────────────
  const { auction, currentLot, lots, onlineCount } = state
  const statusColor = auction?.status === "ACTIVE" ? "bg-green-600" :
                      auction?.status === "PAUSED"  ? "bg-amber-500" :
                      auction?.status === "COMPLETE"? "bg-slate-500" : "bg-blue-700"

  return (
    <div className="relative flex flex-col bg-[#0d1117] text-white" style={{ minHeight: "calc(100vh - 56px)" }}>

      {/* ── Top bar ─────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between px-4 py-2 bg-[#161b2e] border-b border-white/10 shrink-0 gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <span className="text-white font-extrabold text-sm shrink-0">🔨 Controller</span>
          {auction && <span className="text-blue-300 font-semibold text-sm truncate">{auction.title}</span>}
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {/* Pause message indicator */}
          {activePauseMessage && (
            <span className="bg-amber-600 text-white text-[10px] font-bold px-2 py-1 rounded animate-pulse">
              📢 PAUSED: {activePauseMessage.slice(0, 30)}{activePauseMessage.length > 30 ? "…" : ""}
            </span>
          )}

          {auction && (
            <span className={`${statusColor} text-white text-xs font-bold px-3 py-1 rounded-full`}>
              {auction.status}
            </span>
          )}
          <span className="text-slate-400 text-xs">🌐 {onlineCount}</span>

          {/* Camera stream button — prominent in top bar */}
          {isBroadcasting ? (
            <button
              onClick={stopBroadcast}
              className="flex items-center gap-1.5 bg-red-700 hover:bg-red-600 text-white text-xs font-bold px-3 py-1.5 rounded-lg transition-colors"
            >
              <span className="w-2 h-2 rounded-full bg-white animate-ping" />
              LIVE — Stop Camera
            </button>
          ) : (
            <button
              onClick={startBroadcast}
              className="flex items-center gap-1.5 bg-slate-700 hover:bg-red-700 text-slate-300 hover:text-white text-xs font-bold px-3 py-1.5 rounded-lg transition-colors"
            >
              📹 Start Camera
            </button>
          )}
          {cameraError && <span className="text-red-400 text-[10px]">⚠ {cameraError}</span>}

          <button
            onClick={() => { setPhase("select"); emit("clerk:loadAuctions") }}
            className="text-xs text-blue-400 hover:text-white border border-blue-900 hover:border-blue-500 px-3 py-1 rounded transition-colors"
          >
            🔀 Switch
          </button>
        </div>
      </div>

      {/* ── SOLD popup overlay ───────────────────────────────────────────── */}
      {soldPopup && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/60 pointer-events-none">
          <div className="bg-green-600 rounded-2xl px-12 py-10 text-center shadow-2xl border-4 border-green-400 animate-bounce-once">
            <p className="text-white text-6xl font-black mb-2">🔨 SOLD</p>
            <p className="text-white/80 text-lg font-bold mb-1">LOT {soldPopup.lotNumber}</p>
            {soldPopup.title && (
              <p className="text-white/70 text-sm mb-4 max-w-xs mx-auto line-clamp-2">{soldPopup.title}</p>
            )}
            <p className="text-white font-black text-4xl mb-4">
              £{soldPopup.hammerPrice.toLocaleString("en-GB")}
            </p>
            <p className="text-white/60 text-sm">Moving to next lot in {soldCountdown}s…</p>
          </div>
        </div>
      )}

      {/* ── Camera preview bar (shown when live) ─────────────────────────── */}
      {isBroadcasting && (
        <div className="shrink-0 bg-black border-b border-red-900 flex items-center gap-3 px-4 py-1.5">
          <div className="relative rounded overflow-hidden bg-black" style={{ width: 160, height: 90 }}>
            {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
            <video ref={localVideoRef} autoPlay muted playsInline className="w-full h-full object-cover scale-x-[-1]" />
          </div>
          <div>
            <p className="text-red-400 text-xs font-black animate-pulse">🔴 CAMERA LIVE</p>
            <p className="text-slate-500 text-[10px]">Viewers can see your camera stream</p>
          </div>
        </div>
      )}

      {/* ── Main grid ───────────────────────────────────────────────────── */}
      <div className="flex flex-1 overflow-hidden">

        {/* LEFT PANEL */}
        <div className="flex-1 flex flex-col overflow-y-auto p-3 gap-3 min-w-0">

          {/* Lot header */}
          <div className="bg-[#161b2e] border border-white/10 rounded-xl p-4 flex gap-4">
            {/* Thumbnail */}
            <div className="w-24 h-24 shrink-0 rounded-lg bg-[#0d1117] border border-white/10 overflow-hidden flex items-center justify-center">
              {currentLot?.imageUrls?.[0] ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={lotPhotoUrl(currentLot.imageUrls[0]) ?? ""} alt="" className="w-full h-full object-cover" />
              ) : (
                <span className="text-slate-600 text-2xl font-black">{currentLot?.lotNumber ?? "—"}</span>
              )}
            </div>
            {/* Info */}
            <div className="flex-1 min-w-0">
              <div className="text-slate-400 text-xs font-semibold">LOT {currentLot?.lotNumber ?? "—"}</div>
              <div className="text-white font-bold text-base leading-tight mt-0.5 truncate">{currentLot?.title ?? "Waiting..."}</div>
              <div className="text-slate-400 text-xs mt-1 line-clamp-2">{currentLot?.description}</div>
              <div className="text-slate-500 text-xs mt-1">
                Guide: {fmt(currentLot?.estimateLow)} – {fmt(currentLot?.estimateHigh)}
              </div>
            </div>
            {/* Controls */}
            <div className="flex flex-col gap-1.5 shrink-0">
              {auction?.status !== "ACTIVE" && auction?.status !== "COMPLETE" && (
                <button
                  onClick={() => emit("clerk:startAuction")}
                  className="bg-green-600 hover:bg-green-500 text-white text-xs font-bold px-4 py-2 rounded-lg transition-colors"
                >
                  ▶ Start Auction
                </button>
              )}
              {auction?.status === "ACTIVE" && (
                <button
                  onClick={() => emit("clerk:pauseAuction")}
                  className="bg-amber-500 hover:bg-amber-400 text-white text-xs font-bold px-4 py-2 rounded-lg transition-colors"
                >
                  ⏸ Pause
                </button>
              )}
              {auction?.status === "PAUSED" && (
                <button
                  onClick={() => {
                    emit("clerk:resumeAuction")
                    setActivePauseMessage(null)
                    setPauseMessageInput("")
                  }}
                  className="bg-green-600 hover:bg-green-500 text-white text-xs font-bold px-4 py-2 rounded-lg transition-colors"
                >
                  ▶ Resume
                </button>
              )}
              <button
                onClick={() => { if (confirm("Close auction?")) emit("clerk:closeAuction") }}
                className="bg-slate-700 hover:bg-slate-600 text-slate-300 text-xs font-bold px-4 py-2 rounded-lg transition-colors"
              >
                Close Auction
              </button>
              <button
                onClick={() => emit("clerk:withdraw")}
                className="bg-red-900/50 hover:bg-red-800/60 text-red-300 text-xs font-bold px-4 py-2 rounded-lg transition-colors"
              >
                Withdraw Lot
              </button>
            </div>
          </div>

          {/* Current bid strip */}
          <div className="bg-[#1a2234] border border-white/10 rounded-xl px-4 py-3 flex items-center justify-between">
            <div className="text-slate-300 text-sm">
              Current Bid: <span className="text-white font-extrabold text-xl ml-1">{fmt(currentLot?.currentBid ?? 0)}</span>
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => emit("clerk:pass")}
                className="bg-slate-700 hover:bg-slate-600 text-slate-200 text-xs font-bold px-4 py-2 rounded-lg transition-colors"
              >
                Pass Lot
              </button>
              <button
                onClick={() => emit("clerk:undo")}
                className="bg-slate-700 hover:bg-slate-600 text-slate-200 text-xs font-bold px-4 py-2 rounded-lg transition-colors"
              >
                Undo Bid
              </button>
            </div>
          </div>

          {/* Asking bid + increment row */}
          <div className="grid grid-cols-2 gap-3">
            <div className="bg-[#161b2e] border border-white/10 rounded-xl p-3">
              <div className="text-slate-400 text-xs mb-2">Asking Bid — <span className="text-white font-bold">{fmt(currentLot?.askingBid)}</span></div>
              <div className="flex gap-2">
                <div className="flex items-center bg-[#0d1117] border border-white/10 rounded-lg px-2 flex-1">
                  <span className="text-slate-400 text-sm">£</span>
                  <input
                    type="number"
                    className="flex-1 bg-transparent text-white text-sm px-2 py-1.5 outline-none"
                    placeholder="90"
                    value={askingInput}
                    onChange={e => setAskingInput(e.target.value)}
                  />
                </div>
                <button
                  onClick={() => { emit("clerk:setAsking", { amount: parseInt(askingInput) }); setAskingInput("") }}
                  className="bg-blue-700 hover:bg-blue-600 text-white text-xs font-bold px-3 py-1.5 rounded-lg"
                >SET</button>
                <button
                  onClick={() => emit("clerk:setAsking", { amount: (currentLot?.currentBid ?? 0) + (currentLot?.increment ?? 10) })}
                  className="bg-slate-700 hover:bg-slate-600 text-slate-300 text-xs font-bold px-3 py-1.5 rounded-lg"
                >RST</button>
              </div>
            </div>
            <div className="bg-[#161b2e] border border-white/10 rounded-xl p-3">
              <div className="text-slate-400 text-xs mb-2">Set Increment — <span className="text-white font-bold">{fmt(currentLot?.increment)}</span></div>
              <div className="flex gap-2">
                <input
                  type="number"
                  className="flex-1 bg-[#0d1117] border border-white/10 rounded-lg px-3 py-1.5 text-white text-sm outline-none"
                  placeholder="10"
                  value={incrementInput}
                  onChange={e => setIncrementInput(e.target.value)}
                />
                <button
                  onClick={() => { emit("clerk:setIncrement", { amount: parseInt(incrementInput) }); setIncrementInput("") }}
                  className="bg-blue-700 hover:bg-blue-600 text-white text-xs font-bold px-3 py-1.5 rounded-lg"
                >SET</button>
              </div>
            </div>
          </div>

          {/* Quick buttons + bid sources */}
          <div className="grid grid-cols-3 gap-3">

            {/* Set asking bid */}
            <div className="bg-[#161b2e] border border-white/10 rounded-xl p-3">
              <div className="text-slate-400 text-xs font-semibold mb-2">Set Asking Bid</div>
              <div className="grid grid-cols-2 gap-1">
                {[90,100,130,180,280,580,1080,2080,5080,10080].map(amt => (
                  <button
                    key={amt}
                    onClick={() => emit("clerk:setAsking", { amount: amt })}
                    className="bg-[#1e293b] hover:bg-blue-900/50 text-slate-300 hover:text-white text-xs py-1.5 rounded transition-colors font-mono"
                  >
                    {fmt(amt)}
                  </button>
                ))}
              </div>
            </div>

            {/* Set increment */}
            <div className="bg-[#161b2e] border border-white/10 rounded-xl p-3">
              <div className="text-slate-400 text-xs font-semibold mb-2">Set Increment</div>
              <div className="grid grid-cols-2 gap-1">
                {[5,10,20,50,100,200,500,1000,2000,5000].map(amt => (
                  <button
                    key={amt}
                    onClick={() => emit("clerk:setIncrement", { amount: amt })}
                    className="bg-[#1e293b] hover:bg-purple-900/50 text-slate-300 hover:text-white text-xs py-1.5 rounded transition-colors font-mono"
                  >
                    {fmt(amt)}
                  </button>
                ))}
              </div>
            </div>

            {/* Bid sources + hammer */}
            <div className="bg-[#161b2e] border border-white/10 rounded-xl p-3 flex flex-col gap-2">
              <div className="text-slate-400 text-xs font-semibold mb-1">Bid Source</div>
              {(["Room","Telephone","Invaluable","Saleroom"] as const).map(type => (
                <button
                  key={type}
                  onClick={() => emit("clerk:bid", { type })}
                  className={`text-white text-xs font-bold py-2.5 px-3 rounded-lg text-left transition-colors ${
                    type === "Room"       ? "bg-blue-700 hover:bg-blue-600" :
                    type === "Telephone"  ? "bg-indigo-700 hover:bg-indigo-600" :
                    type === "Invaluable" ? "bg-violet-700 hover:bg-violet-600" :
                                           "bg-slate-700 hover:bg-slate-600"
                  }`}
                >
                  {type}: <span className="font-extrabold">{fmt(currentLot?.askingBid)}</span>
                </button>
              ))}

              {/* Fair Warning + Hammer */}
              <button
                onClick={() => emit("clerk:fairWarning")}
                className={`text-white text-xs font-bold py-2.5 px-3 rounded-lg transition-colors mt-1 ${
                  fairWarningFlash ? "bg-amber-400 animate-pulse" : "bg-amber-600 hover:bg-amber-500"
                }`}
              >
                ⚠️ Fair Warning
              </button>
              <button
                onClick={() => emit("clerk:hammer")}
                className={`text-white text-sm font-extrabold py-3 px-3 rounded-lg transition-colors ${
                  hammerFlash ? "bg-red-400 scale-105" : "bg-red-600 hover:bg-red-500"
                }`}
              >
                🔨 Hammer: {fmt(currentLot?.currentBid ?? 0)}
              </button>
            </div>
          </div>

          {/* Online bid alert */}
          {onlineBidAlert && (
            <div className="bg-blue-900/60 border border-blue-500 rounded-xl px-4 py-3 flex items-center gap-3">
              <span className="text-blue-300 font-bold text-sm">🌐 Online Bid!</span>
              <span className="text-white text-sm flex-1">
                {onlineBidAlert.bidderName} — {fmt(onlineBidAlert.amount)}
              </span>
              <button
                onClick={() => { emit("clerk:bid", { type: "Online", bidderName: onlineBidAlert.bidderName }); setOnlineBidAlert(null) }}
                className="bg-green-600 hover:bg-green-500 text-white text-xs font-bold px-3 py-1.5 rounded-lg"
              >Accept</button>
              <button
                onClick={() => setOnlineBidAlert(null)}
                className="bg-slate-700 hover:bg-slate-600 text-slate-300 text-xs font-bold px-3 py-1.5 rounded-lg"
              >Dismiss</button>
            </div>
          )}

          {/* Auto-bid manager */}
          <div className="bg-[#161b2e] border border-white/10 rounded-xl p-3">
            <div className="text-slate-400 text-xs font-semibold mb-2">Add Auto-Bid / Phone Max</div>
            <div className="flex gap-2">
              <input
                type="text"
                className="w-28 bg-[#0d1117] border border-white/10 rounded-lg px-3 py-1.5 text-white text-sm outline-none"
                placeholder="Bidder ID"
                value={autoBidBidder}
                onChange={e => setAutoBidBidder(e.target.value)}
              />
              <div className="flex items-center bg-[#0d1117] border border-white/10 rounded-lg px-2 flex-1">
                <span className="text-slate-400 text-sm">£</span>
                <input
                  type="number"
                  className="flex-1 bg-transparent text-white text-sm px-2 py-1.5 outline-none"
                  placeholder="Max amount"
                  value={autoBidMax}
                  onChange={e => setAutoBidMax(e.target.value)}
                />
              </div>
              <button
                onClick={() => {
                  if (!autoBidBidder || !autoBidMax) return
                  emit("clerk:addAutoBid", { bidderId: autoBidBidder, maxAmount: parseInt(autoBidMax) })
                  setAutoBidBidder(""); setAutoBidMax("")
                }}
                className="bg-purple-700 hover:bg-purple-600 text-white text-xs font-bold px-4 py-1.5 rounded-lg"
              >Add</button>
            </div>
          </div>

          {/* Pause & Message */}
          <div className={`rounded-xl p-3 border ${activePauseMessage ? "bg-amber-900/30 border-amber-600" : "bg-[#161b2e] border-white/10"}`}>
            <div className="text-slate-400 text-xs font-semibold mb-2">📢 Pause & Show Message to Viewers</div>
            <div className="flex gap-2 mb-2">
              <input
                type="text"
                className="flex-1 bg-[#0d1117] border border-white/10 rounded-lg px-3 py-1.5 text-white text-sm outline-none placeholder:text-slate-600"
                placeholder="e.g. Back in 15 minutes, comfort break…"
                value={pauseMessageInput}
                onChange={e => setPauseMessageInput(e.target.value)}
                onKeyDown={e => {
                  if (e.key === "Enter" && pauseMessageInput.trim()) {
                    emit("clerk:setPauseMessage", { message: pauseMessageInput.trim() })
                    setActivePauseMessage(pauseMessageInput.trim())
                  }
                }}
              />
              <button
                onClick={() => {
                  if (!pauseMessageInput.trim()) return
                  emit("clerk:setPauseMessage", { message: pauseMessageInput.trim() })
                  setActivePauseMessage(pauseMessageInput.trim())
                }}
                className="bg-amber-600 hover:bg-amber-500 text-white text-xs font-bold px-3 py-1.5 rounded-lg transition-colors whitespace-nowrap"
              >
                Set & Pause
              </button>
              {activePauseMessage && (
                <button
                  onClick={() => {
                    emit("clerk:setPauseMessage", { message: "" })
                    setActivePauseMessage(null)
                    setPauseMessageInput("")
                  }}
                  className="bg-slate-700 hover:bg-slate-600 text-slate-300 text-xs font-bold px-3 py-1.5 rounded-lg transition-colors"
                >
                  Clear
                </button>
              )}
            </div>
            {activePauseMessage && (
              <p className="text-amber-400 text-[10px]">
                ⚠️ Viewers are currently seeing: &quot;{activePauseMessage}&quot;
              </p>
            )}
          </div>

          {/* Lot navigation strip */}
          <div className="bg-[#161b2e] border border-white/10 rounded-xl p-3 flex items-center gap-3">
            <button
              onClick={() => emit("clerk:prevLot")}
              className="bg-slate-700 hover:bg-slate-600 text-slate-200 text-xs font-bold px-4 py-2 rounded-lg shrink-0"
            >◀ Prev</button>
            <div className="flex-1 flex gap-1.5 overflow-x-auto py-1">
              {lots.map((l, i) => (
                <button
                  key={l.id}
                  onClick={() => emit("clerk:goToLot", { index: i })}
                  title={l.title}
                  className={`shrink-0 w-10 h-10 rounded-lg text-xs font-bold transition-colors ${
                    i === (auction?.currentLotIndex ?? -1)
                      ? "bg-blue-600 text-white ring-2 ring-blue-400"
                      : l.status === "SOLD"
                      ? "bg-green-900/60 text-green-400"
                      : l.status === "PASSED" || l.status === "WITHDRAWN"
                      ? "bg-red-900/40 text-red-400"
                      : "bg-[#1e293b] text-slate-400 hover:text-white"
                  }`}
                >
                  {l.lotNumber}
                </button>
              ))}
            </div>
            <button
              onClick={() => emit("clerk:nextLot")}
              className="bg-slate-700 hover:bg-slate-600 text-slate-200 text-xs font-bold px-4 py-2 rounded-lg shrink-0"
            >Next ▶</button>
          </div>

        </div>

        {/* RIGHT PANEL */}
        <div className="w-72 shrink-0 flex flex-col border-l border-white/10 overflow-y-auto">

          {/* Bid history */}
          <div className="border-b border-white/10">
            <div className="grid grid-cols-3 text-slate-500 text-xs font-semibold px-3 py-2 bg-[#0f1621]">
              <span>User</span><span className="text-center">Amount</span><span className="text-right">Type</span>
            </div>
            <div className="max-h-52 overflow-y-auto">
              {(!currentLot?.bids || currentLot.bids.length === 0) ? (
                <div className="text-slate-600 text-xs text-center py-4">No bids yet</div>
              ) : (
                [...(currentLot.bids)].reverse().map((b, i) => (
                  <div key={i} className={`grid grid-cols-3 text-xs px-3 py-1.5 ${i === 0 ? "bg-blue-900/20" : "hover:bg-white/5"}`}>
                    <span className="text-slate-400 truncate">{b.bidderName ?? b.bidderId ?? "—"}</span>
                    <span className="text-white font-bold text-center">{fmt(b.amount)}</span>
                    <span className={`text-right font-semibold ${
                      b.type === "Online" ? "text-blue-400" :
                      b.type === "Auto"   ? "text-purple-400" :
                      b.type === "Telephone" ? "text-indigo-400" : "text-slate-400"
                    }`}>{b.type}</span>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Quick results */}
          <div className="flex-1 p-3">
            <div className="text-slate-400 text-xs font-semibold mb-2">Recent Results</div>
            {recentResults.length === 0 ? (
              <div className="text-slate-600 text-xs text-center py-4">No results yet</div>
            ) : (
              <div className="flex flex-col gap-1">
                {recentResults.map((r, i) => (
                  <div key={i} className="flex items-center justify-between bg-[#0f1621] rounded-lg px-3 py-2">
                    <div>
                      <span className="text-slate-500 text-xs">Lot {r.lotNumber}</span>
                      <div className="text-white text-xs font-semibold truncate max-w-[140px]">{r.title}</div>
                    </div>
                    <span className="text-green-400 font-bold text-sm">{fmt(r.hammerPrice)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

        </div>
      </div>
    </div>
  )
}
