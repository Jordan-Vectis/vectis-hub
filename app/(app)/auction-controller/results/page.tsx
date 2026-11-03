"use client"

import { useEffect, useRef, useState } from "react"
import { io as ioClient, Socket } from "socket.io-client"

interface BidEntry {
  amount: number
  type: string
  bidderId?: string
  bidderName?: string
  timestamp: string
}

interface LotResult {
  id: string
  lotNumber: string
  title: string
  status: string
  currentBid: number
  hammerPrice: number | null
}

interface AuctionState {
  auction: {
    title: string
    code: string
    status: string
    currentLotIndex: number
    totalLots: number
  } | null
  currentLot: {
    id: string
    lotNumber: string
    title: string
    currentBid: number
    askingBid: number
    bids: BidEntry[]
  } | null
  lots: LotResult[]
  onlineCount: number
}

interface PastAuction {
  id: string
  name: string
  code: string
  auctionDate: string | null
  finished: boolean
  complete: boolean
  _count: { lots: number }
}

interface DbLot {
  id: string
  lotNumber: string
  title: string
  status: string
  hammerPrice: number | null
  currentBid: number | null
  estimateLow: number | null
  estimateHigh: number | null
}

interface FlatBid {
  lotNumber: string
  lotId: string
  lotStatus: string
  hammerPrice: number | null
  isWinner: boolean
  amount: number
  type: string
  bidderId?: string
  bidderName?: string
  timestamp: string
}

function fmt(n: number | null | undefined) {
  if (!n && n !== 0) return "—"
  return `£${n.toLocaleString("en-GB")}`
}

function fmtDatetime(iso: string) {
  try {
    const d = new Date(iso)
    return d.toLocaleDateString("en-GB") + " " + d.toLocaleTimeString("en-GB", {
      hour: "2-digit", minute: "2-digit", second: "2-digit",
    })
  } catch { return iso }
}

function bidTypeLabel(type: string) {
  switch (type) {
    case "Online":    return "Online"
    case "Auto":      return "Vectis Auto"
    case "Telephone": return "Telephone"
    case "Room":      return "Saleroom"
    default:          return type ?? "—"
  }
}

export default function ResultsPage() {
  // ── Live socket state ────────────────────────────────────────────────────
  const [state, setState] = useState<AuctionState | null>(null)
  const [lotBids, setLotBids] = useState<Record<string, BidEntry[]>>({})
  const [lotTitles, setLotTitles] = useState<Record<string, string>>({})
  const [watchError, setWatchError] = useState<string | null>(null)
  const socketRef = useRef<Socket | null>(null)

  // ── DB / historical state ────────────────────────────────────────────────
  const [pastAuctions, setPastAuctions] = useState<PastAuction[]>([])
  const [selectedAuctionId, setSelectedAuctionId] = useState<string | null>(null)
  const [dbAuctionName, setDbAuctionName] = useState<string>("")
  const [dbLots, setDbLots] = useState<DbLot[]>([])
  const [dbLoading, setDbLoading] = useState(false)

  // ── Socket connection ────────────────────────────────────────────────────
  useEffect(() => {
    const socket = ioClient(window.location.origin, { transports: ["websocket", "polling"] })
    socketRef.current = socket

    socket.on("connect", () => {
      socket.emit("bidder:join", { name: "Results View" })
      // Bidder names and ids come only to staff with Auction Controller access.
      socket.emit("staff:watch")
    })
    socket.on("staff:watch:fail", ({ message }: { message: string }) => setWatchError(message))

    socket.on("auction:state", (s: AuctionState) => {
      setState(s)
      if (s.currentLot) {
        const { id, bids, title } = s.currentLot
        if (bids?.length) setLotBids(prev => ({ ...prev, [id]: bids }))
        if (title)       setLotTitles(prev => ({ ...prev, [id]: title }))
      }
    })

    return () => { socket.disconnect() }
  }, [])

  // ── Load past auctions list ──────────────────────────────────────────────
  useEffect(() => {
    fetch("/api/auction-results")
      .then(r => r.json())
      .then(setPastAuctions)
      .catch(() => {})
  }, [])

  // ── Load DB lots when an auction is selected ────────────────────────────
  useEffect(() => {
    if (!selectedAuctionId) return
    setDbLoading(true)
    fetch(`/api/auction-results?auctionId=${selectedAuctionId}`)
      .then(r => r.json())
      .then(data => {
        setDbAuctionName(data.auction?.name ?? "")
        setDbLots(data.lots ?? [])
        setDbLoading(false)
      })
      .catch(() => setDbLoading(false))
  }, [selectedAuctionId])

  // ── Derived live data ────────────────────────────────────────────────────
  const auction = state?.auction
  const lots = state?.lots ?? []
  const completedLots = lots.filter(l =>
    l.status === "SOLD" || l.status === "PASSED" || l.status === "WITHDRAWN"
  )
  const totalSold  = completedLots.filter(l => l.status === "SOLD").length
  const totalValue = completedLots.reduce((sum, l) => sum + (l.hammerPrice ?? 0), 0)

  // Flat live bid list
  const flatBids: FlatBid[] = []
  for (const lot of [...completedLots].reverse()) {
    const bids = lotBids[lot.id] ?? []
    bids.forEach((bid, idx) => {
      flatBids.push({
        lotNumber:  lot.lotNumber,
        lotId:      lot.id,
        lotStatus:  lot.status,
        hammerPrice: lot.hammerPrice,
        isWinner:   idx === bids.length - 1 && lot.status === "SOLD",
        amount:     bid.amount,
        type:       bid.type,
        bidderId:   bid.bidderId,
        bidderName: bid.bidderName,
        timestamp:  bid.timestamp,
      })
    })
  }
  flatBids.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())

  // ── DB derived data ──────────────────────────────────────────────────────
  const dbCompleted = dbLots.filter(l => l.status === "SOLD" || l.status === "PASSED" || l.status === "WITHDRAWN")
  const dbSold      = dbCompleted.filter(l => l.status === "SOLD")
  const dbTotal     = dbSold.reduce((s, l) => s + (l.hammerPrice ?? 0), 0)

  const isLive = !!auction

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">

      {watchError && (
        <div className="bg-amber-100 text-amber-900 text-sm px-6 py-2">
          Bidder names are hidden on the live sale — {watchError}
        </div>
      )}

      {/* ── Header ── */}
      <div className="bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between sticky top-0 z-10 shadow-sm">
        <div>
          <h1 className="text-gray-900 font-black text-xl">
            {isLive ? "Live Results" : selectedAuctionId ? dbAuctionName || "Results" : "Auction Results"}
          </h1>
          {isLive && auction && <p className="text-gray-400 text-sm mt-0.5">{auction.title}</p>}
          {!isLive && (
            <div className="mt-1 flex items-center gap-2">
              <select
                value={selectedAuctionId ?? ""}
                onChange={e => {
                  setSelectedAuctionId(e.target.value || null)
                  setDbLots([])
                }}
                className="text-sm border border-gray-200 rounded px-2 py-1 text-gray-700 focus:outline-none focus:border-[#32348A]"
              >
                <option value="">— Select a past auction —</option>
                {pastAuctions.map(a => (
                  <option key={a.id} value={a.id}>
                    {a.name}{a.auctionDate ? ` — ${new Date(a.auctionDate).toLocaleDateString("en-GB")}` : ""}
                  </option>
                ))}
              </select>
              {isLive === false && (
                <span className="text-xs text-gray-400 bg-gray-100 px-2 py-0.5 rounded">No live auction</span>
              )}
            </div>
          )}
        </div>

        <div className="flex items-center gap-10">
          <div className="text-center">
            <p className="text-green-500 font-black text-3xl leading-none">
              {isLive ? totalSold : dbSold.length}
            </p>
            <p className="text-gray-400 text-[10px] uppercase tracking-widest mt-1">Sold</p>
          </div>
          <div className="text-center">
            <p className="text-red-500 font-black text-3xl leading-none">
              {isLive ? completedLots.length - totalSold : dbCompleted.length - dbSold.length}
            </p>
            <p className="text-gray-400 text-[10px] uppercase tracking-widest mt-1">Unsold</p>
          </div>
          <div className="text-center">
            <p className="text-[#32348A] font-black text-3xl leading-none">
              {fmt(isLive ? totalValue : dbTotal)}
            </p>
            <p className="text-gray-400 text-[10px] uppercase tracking-widest mt-1">Total</p>
          </div>
          {isLive && (
            <div className="text-center">
              <p className="text-gray-700 font-black text-3xl leading-none">{state?.onlineCount ?? 0}</p>
              <p className="text-gray-400 text-[10px] uppercase tracking-widest mt-1">Online</p>
            </div>
          )}
        </div>
      </div>

      {/* ── Live lot strip ── */}
      {state?.currentLot && (
        <div className="bg-[#1a2744] px-6 py-3 flex items-center gap-6">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-red-500 animate-ping" />
            <span className="text-blue-300 font-bold text-sm">LOT {state.currentLot.lotNumber}</span>
          </div>
          <span className="text-white text-sm font-semibold truncate max-w-sm">{state.currentLot.title}</span>
          <span className="text-[#2AB4A6] font-black">{fmt(state.currentLot.currentBid)}</span>
          <span className="text-gray-400 text-xs">Asking: {fmt(state.currentLot.askingBid)}</span>
          <span className="text-gray-500 text-xs ml-auto">{state.currentLot.bids.length} bids so far</span>
        </div>
      )}

      {/* ── Content ── */}
      <div className="flex-1 overflow-auto">

        {/* ── LIVE bid table ── */}
        {isLive && (
          flatBids.length === 0 ? (
            <p className="text-gray-400 text-center py-20">No bids recorded yet</p>
          ) : (
            <LiveBidTable flatBids={flatBids} />
          )
        )}

        {/* ── DB / historical view ── */}
        {!isLive && !selectedAuctionId && (
          <div className="flex flex-col items-center justify-center py-24 gap-3">
            <p className="text-gray-400 text-lg">No live auction running</p>
            <p className="text-gray-400 text-sm">Select a past auction above to view results</p>
          </div>
        )}

        {!isLive && selectedAuctionId && dbLoading && (
          <p className="text-gray-400 text-center py-16 animate-pulse">Loading…</p>
        )}

        {!isLive && selectedAuctionId && !dbLoading && dbLots.length === 0 && (
          <p className="text-gray-400 text-center py-16">No lots found for this auction</p>
        )}

        {!isLive && selectedAuctionId && !dbLoading && dbLots.length > 0 && (
          <DbResultsTable lots={dbLots} />
        )}
      </div>
    </div>
  )
}

// ── Live bid table (socket data) ────────────────────────────────────────────
function LiveBidTable({ flatBids }: { flatBids: FlatBid[] }) {
  return (
    <table className="w-full text-sm border-collapse bg-white">
      <thead className="sticky top-[73px] z-10 bg-gray-50 border-b border-gray-200">
        <tr>
          <th className="text-left px-4 py-3 text-gray-400 font-bold text-[10px] uppercase tracking-widest w-20"></th>
          <th className="text-left px-4 py-3 text-gray-400 font-bold text-[10px] uppercase tracking-widest">Customer No.</th>
          <th className="text-left px-4 py-3 text-gray-400 font-bold text-[10px] uppercase tracking-widest">Customer Name</th>
          <th className="text-left px-4 py-3 text-gray-400 font-bold text-[10px] uppercase tracking-widest">Bid Type</th>
          <th className="text-left px-4 py-3 text-gray-400 font-bold text-[10px] uppercase tracking-widest">Bid Amount</th>
          <th className="text-left px-4 py-3 text-gray-400 font-bold text-[10px] uppercase tracking-widest">Status</th>
          <th className="text-left px-4 py-3 text-gray-400 font-bold text-[10px] uppercase tracking-widest">Time</th>
        </tr>
      </thead>
      <tbody>
        {flatBids.map((bid, i) => (
          <tr key={`${bid.lotId}-${i}`} className="border-b border-gray-100 hover:bg-gray-50 transition-colors">
            <td className="px-4 py-3">
              <span className="inline-flex items-center justify-center w-10 h-10 rounded-lg bg-[#32348A] text-white font-black text-sm">
                {bid.lotNumber}
              </span>
            </td>
            <td className="px-4 py-3">
              <span className="text-[#32348A] font-semibold text-sm">
                {bid.bidderId ? `C${bid.bidderId}` : "0"}
              </span>
            </td>
            <td className="px-4 py-3 text-gray-700 font-medium">
              {bid.bidderName || (bid.type === "Room" ? "Clerk" : "—")}
            </td>
            <td className="px-4 py-3 text-gray-500">
              {bidTypeLabel(bid.type)}
            </td>
            <td className="px-4 py-3">
              <span className="text-gray-900 font-bold">{fmt(bid.amount)}</span>
            </td>
            <td className="px-4 py-3">
              {bid.isWinner ? (
                <span className="text-green-600 font-semibold text-xs">
                  Sold {fmtDatetime(bid.timestamp)}
                </span>
              ) : (bid.lotStatus === "PASSED" || bid.lotStatus === "WITHDRAWN") ? (
                <span className="text-red-400 text-xs font-semibold">{bid.lotStatus}</span>
              ) : null}
            </td>
            <td className="px-4 py-3 text-gray-400 text-xs">
              {fmtDatetime(bid.timestamp)}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

// ── DB results table (lot-level, no individual bid history) ─────────────────
function DbResultsTable({ lots }: { lots: DbLot[] }) {
  return (
    <table className="w-full text-sm border-collapse bg-white">
      <thead className="sticky top-[73px] z-10 bg-gray-50 border-b border-gray-200">
        <tr>
          <th className="text-left px-4 py-3 text-gray-400 font-bold text-[10px] uppercase tracking-widest w-20"></th>
          <th className="text-left px-4 py-3 text-gray-400 font-bold text-[10px] uppercase tracking-widest">Title</th>
          <th className="text-left px-4 py-3 text-gray-400 font-bold text-[10px] uppercase tracking-widest">Estimate</th>
          <th className="text-left px-4 py-3 text-gray-400 font-bold text-[10px] uppercase tracking-widest">Hammer Price</th>
          <th className="text-left px-4 py-3 text-gray-400 font-bold text-[10px] uppercase tracking-widest">Result</th>
        </tr>
      </thead>
      <tbody>
        {lots.map((lot, i) => {
          const isSold = lot.status === "SOLD"
          const isPassed = lot.status === "PASSED" || lot.status === "WITHDRAWN"
          return (
            <tr key={lot.id} className={`border-b border-gray-100 hover:bg-gray-50 transition-colors ${isSold ? "" : "opacity-60"}`}>
              <td className="px-4 py-3">
                <span className={`inline-flex items-center justify-center w-10 h-10 rounded-lg text-white font-black text-sm ${
                  isSold ? "bg-[#32348A]" : isPassed ? "bg-red-400" : "bg-gray-300"
                }`}>
                  {lot.lotNumber}
                </span>
              </td>
              <td className="px-4 py-3 text-gray-700 font-medium max-w-xs truncate">{lot.title}</td>
              <td className="px-4 py-3 text-gray-500 text-xs">
                {lot.estimateLow || lot.estimateHigh
                  ? `${fmt(lot.estimateLow)} – ${fmt(lot.estimateHigh)}`
                  : "—"}
              </td>
              <td className="px-4 py-3">
                <span className={`font-bold ${isSold ? "text-gray-900" : "text-gray-400"}`}>
                  {fmt(lot.hammerPrice)}
                </span>
              </td>
              <td className="px-4 py-3">
                {isSold ? (
                  <span className="text-green-600 font-semibold text-xs">SOLD</span>
                ) : isPassed ? (
                  <span className="text-red-400 font-semibold text-xs">{lot.status}</span>
                ) : (
                  <span className="text-gray-400 text-xs">PENDING</span>
                )}
              </td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}
