"use client"

import { useEffect, useRef, useState } from "react"

// Auction Monitor — v1
// Connects directly to the Vectis bidstream WebSocket
// (wss://www.vectis.co.uk/wss/{auctionId}) and surfaces health signals:
//   - Connection state (open / connecting / dropped / closed)
//   - Time since last message — primary stall indicator
//   - Best-effort parsed lot / bid / time-remaining once we know the format
//   - Raw message log so we can refine the parser once we've seen the wire data

type MsgEntry = {
  at:        Date
  raw:       string
  parsed:    any            // attempted JSON parse; falls back to null
}

type ConnState = "idle" | "connecting" | "open" | "closing" | "closed" | "error"

const WS_TEMPLATE = "wss://www.vectis.co.uk/wss/{id}"
const RECONNECT_DELAY_MS = 5000
const STALE_AMBER_MS     = 30_000   // amber after no messages for 30s
const STALE_RED_MS       = 120_000  // red after 2 min — definite stall
const MAX_LOG_ROWS       = 200

export default function AuctionMonitorPage() {
  // Persist the last auction ID across reloads — handy for the wall-display use case
  const [auctionId, setAuctionId] = useState<string>(() => {
    if (typeof window === "undefined") return ""
    return localStorage.getItem("auction_monitor_id") ?? ""
  })
  const [running, setRunning] = useState(false)
  const [connState, setConnState] = useState<ConnState>("idle")
  const [lastMessageAt, setLastMessageAt] = useState<Date | null>(null)
  const [log, setLog] = useState<MsgEntry[]>([])
  const [reconnects, setReconnects] = useState(0)
  const [showRaw, setShowRaw] = useState(true)
  const [now, setNow] = useState<Date>(new Date())

  // Ticking clock for the "X seconds ago" display
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(t)
  }, [])

  // WS lifecycle — open on Start, close on Stop, auto-reconnect on drop
  const wsRef             = useRef<WebSocket | null>(null)
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const shouldReconnectRef = useRef(false)

  useEffect(() => {
    if (!running) {
      shouldReconnectRef.current = false
      if (wsRef.current) {
        try { wsRef.current.close() } catch {}
        wsRef.current = null
      }
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current)
        reconnectTimerRef.current = null
      }
      setConnState("idle")
      return
    }

    shouldReconnectRef.current = true
    const url = WS_TEMPLATE.replace("{id}", auctionId.trim())

    function openSocket() {
      if (!shouldReconnectRef.current) return
      setConnState("connecting")
      try {
        const ws = new WebSocket(url)
        wsRef.current = ws

        ws.onopen = () => {
          setConnState("open")
        }
        ws.onmessage = (ev) => {
          const raw = typeof ev.data === "string" ? ev.data : "[binary]"
          let parsed: any = null
          try { parsed = JSON.parse(raw) } catch {}
          setLastMessageAt(new Date())
          setLog(prev => {
            const next = [{ at: new Date(), raw, parsed }, ...prev]
            return next.length > MAX_LOG_ROWS ? next.slice(0, MAX_LOG_ROWS) : next
          })
        }
        ws.onerror = () => setConnState("error")
        ws.onclose = () => {
          wsRef.current = null
          setConnState("closed")
          if (shouldReconnectRef.current) {
            setReconnects(r => r + 1)
            reconnectTimerRef.current = setTimeout(openSocket, RECONNECT_DELAY_MS)
          }
        }
      } catch (e) {
        setConnState("error")
        if (shouldReconnectRef.current) {
          reconnectTimerRef.current = setTimeout(openSocket, RECONNECT_DELAY_MS)
        }
      }
    }
    openSocket()

    return () => {
      shouldReconnectRef.current = false
      if (wsRef.current) {
        try { wsRef.current.close() } catch {}
        wsRef.current = null
      }
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running, auctionId])

  function start() {
    if (!auctionId.trim()) return
    localStorage.setItem("auction_monitor_id", auctionId.trim())
    setLog([])
    setLastMessageAt(null)
    setReconnects(0)
    setRunning(true)
  }
  function stop() {
    setRunning(false)
  }

  // Proper event-aware parsing now that we've seen the protocol.
  //   liveBidEvent     → lot_id, amount, asking, winner paddle, platform
  //   sensorNetworkEvent (bidbutton) → auctioneer activity
  // We track the LATEST liveBidEvent for the "current state" panel, plus the
  // time of the last bid for the stall signal (sensor pings happen constantly
  // and would mask a stall if used).
  const state = extractAuctionState(log)
  const msSinceLast    = lastMessageAt ? now.getTime() - lastMessageAt.getTime() : null
  const msSinceLastBid = state.lastBidAt ? now.getTime() - state.lastBidAt.getTime() : null

  // Status derivation
  let healthBand: "green" | "amber" | "red" | "grey" = "grey"
  let healthLabel = "Not started"
  if (running) {
    if (connState !== "open") {
      healthBand = "red"
      healthLabel = `Connection ${connState}`
    } else if (msSinceLast === null) {
      healthBand = "amber"
      healthLabel = "Connected — waiting for first message"
    } else if (msSinceLast > STALE_RED_MS) {
      // No traffic at all = definitely something wrong with the feed
      healthBand = "red"
      healthLabel = "No messages for over 2 minutes — feed may have dropped"
    } else if (state.paused) {
      // Paused is a deliberate state, not an error — amber so it stands out
      // visually but doesn't read as a problem.
      healthBand = "amber"
      healthLabel = "Auction paused by auctioneer"
    } else if (msSinceLastBid === null) {
      healthBand = "amber"
      healthLabel = "Connected — waiting for first bid event"
    } else if (msSinceLastBid > STALE_RED_MS) {
      healthBand = "red"
      healthLabel = "No bid activity for over 2 minutes — auction may be stuck"
    } else if (msSinceLastBid > STALE_AMBER_MS) {
      healthBand = "amber"
      healthLabel = "No bid activity for 30+ seconds — keep an eye on it"
    } else {
      healthBand = "green"
      healthLabel = "Live and active"
    }
  }

  const bandStyle: Record<typeof healthBand, string> = {
    green: "bg-emerald-500",
    amber: "bg-amber-500",
    red:   "bg-red-500",
    grey:  "bg-gray-400",
  }

  return (
    <div className="p-6 max-w-6xl" style={{ fontFamily: "Arial, sans-serif" }}>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Auction Monitor</h1>
        <p className="text-sm text-gray-500 mt-1">
          Watches a live timed auction's WebSocket feed for stalls, dropped connections and silent gaps.
          Connects to <code className="font-mono text-xs bg-gray-100 px-1 py-0.5 rounded">wss://www.vectis.co.uk/wss/&#123;id&#125;</code>.
        </p>
      </div>

      {/* Controls */}
      <div className="bg-white rounded-xl border border-gray-200 p-4 mb-6 flex items-end gap-3 flex-wrap">
        <div className="flex-1 min-w-[200px]">
          <label className="block text-xs font-medium text-gray-600 mb-1">Auction ID</label>
          <input
            type="text"
            value={auctionId}
            onChange={e => setAuctionId(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter" && !running) start() }}
            placeholder="e.g. 1386"
            disabled={running}
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-50"
          />
          <p className="text-[11px] text-gray-500 mt-1">
            From the URL: <span className="font-mono">…com_bidstream&amp;id=</span><strong>1386</strong>
          </p>
        </div>
        {!running ? (
          <button
            onClick={start}
            disabled={!auctionId.trim()}
            className="bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-sm font-semibold px-5 py-2 rounded-lg"
          >▶ Start monitoring</button>
        ) : (
          <button
            onClick={stop}
            className="bg-red-600 hover:bg-red-700 text-white text-sm font-semibold px-5 py-2 rounded-lg"
          >■ Stop</button>
        )}
      </div>

      {/* Status header */}
      <div className="bg-white rounded-xl border border-gray-200 p-5 mb-6">
        <div className="flex items-center gap-3 mb-4">
          <span className={`inline-block w-3 h-3 rounded-full ${bandStyle[healthBand]} ${running && healthBand !== "red" ? "animate-pulse" : ""}`} />
          <h2 className="text-lg font-bold text-gray-900">{healthLabel}</h2>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 text-sm">
          <Stat label="Connection"  value={connState} />
          <Stat label="Last message" value={msSinceLast === null ? "—" : formatAgo(msSinceLast)} />
          <Stat label="Messages received" value={log.length.toLocaleString()} />
          <Stat label="Reconnects"  value={reconnects.toLocaleString()} />
        </div>

        {/* Sale-state badges — flags from getFairWarningStatus + activeLotLock */}
        {(state.saleStateAt || state.lotLockAt) && (
          <div className="mt-4 flex flex-wrap items-center gap-2">
            {state.paused && (
              <span className="bg-amber-100 border border-amber-300 text-amber-900 text-xs font-semibold px-2.5 py-1 rounded">⏸ PAUSED</span>
            )}
            {state.fairWarning && (
              <span className="bg-red-100 border border-red-300 text-red-900 text-xs font-semibold px-2.5 py-1 rounded animate-pulse">🔨 FAIR WARNING</span>
            )}
            {state.bidQuicker && (
              <span className="bg-orange-100 border border-orange-300 text-orange-900 text-xs font-semibold px-2.5 py-1 rounded">⚡ BID QUICKER</span>
            )}
            {state.saleMessage && (
              <span className="bg-blue-100 border border-blue-300 text-blue-900 text-xs font-semibold px-2.5 py-1 rounded">💬 MESSAGE</span>
            )}
            {!state.paused && !state.fairWarning && !state.bidQuicker && !state.saleMessage && (
              <span className="text-xs text-gray-500">Sale state: normal</span>
            )}
            {state.lotLockStatus !== null && state.lotLockStatus !== 0 && (
              <span className="bg-purple-100 border border-purple-300 text-purple-900 text-xs font-semibold px-2.5 py-1 rounded">🔒 Lot lock {state.lotLockStatus}</span>
            )}
          </div>
        )}

        {/* Auction state from liveBidEvent */}
        {state.currentLotId !== null && (
          <div className="mt-4 pt-4 border-t border-gray-100">
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 text-sm">
              <Stat label="Current lot" value={String(state.currentLotId)} />
              <Stat label="Current bid"  value={state.currentBid  != null ? `£${state.currentBid.toLocaleString()}`  : "—"} />
              <Stat label="Asking bid"   value={state.askingBid   != null ? `£${state.askingBid.toLocaleString()}`   : "—"} />
              <Stat label="Winning paddle" value={state.winner != null ? String(state.winner) : "—"} />
              <Stat label="Platform"     value={state.platform ?? "—"} />
            </div>
            <div className="mt-3 grid grid-cols-1 sm:grid-cols-4 gap-3 text-sm">
              <Stat label="Last bid" value={state.lastBidAt ? formatAgo(now.getTime() - state.lastBidAt.getTime()) : "—"} />
              <Stat label="Bids on this lot" value={state.bidsThisLot.toLocaleString()} />
              <Stat label="Lots advanced this session" value={state.lotsSeen.toLocaleString()} />
              <Stat
                label="Bids by platform"
                value={
                  Object.keys(state.platformCounts).length === 0
                    ? "—"
                    : Object.entries(state.platformCounts)
                        .sort((a, b) => b[1] - a[1])
                        .map(([k, v]) => `${k}:${v}`)
                        .join(", ")
                }
              />
            </div>
          </div>
        )}
      </div>

      {/* Raw message log */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-gray-700">Message log ({log.length})</h3>
          <div className="flex items-center gap-3">
            <label className="text-xs text-gray-500 flex items-center gap-1.5 cursor-pointer">
              <input type="checkbox" checked={showRaw} onChange={e => setShowRaw(e.target.checked)} />
              Show raw payload
            </label>
            <CopyAllButton log={log} />
            <button
              onClick={() => setLog([])}
              className="text-xs text-gray-500 hover:text-red-600"
            >Clear</button>
          </div>
        </div>
        {log.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-gray-400">
            {running ? "Waiting for messages from the auction…" : "Click Start to begin monitoring."}
          </p>
        ) : (
          <ul className="divide-y divide-gray-100 max-h-[60vh] overflow-y-auto">
            {log.map((m, i) => (
              <li key={i} className="px-4 py-2 text-xs hover:bg-gray-50">
                <div className="flex items-baseline gap-3 mb-0.5">
                  <span className="text-gray-400 font-mono shrink-0">{m.at.toLocaleTimeString("en-GB")}</span>
                  <span className="text-gray-700 font-medium">
                    {m.parsed ? describeMessage(m.parsed) : "(non-JSON)"}
                  </span>
                </div>
                {showRaw && (
                  <pre className="bg-gray-50 border border-gray-100 rounded px-2 py-1 mt-1 font-mono text-[11px] text-gray-600 overflow-x-auto whitespace-pre-wrap break-all">
                    {m.parsed ? JSON.stringify(m.parsed, null, 2) : m.raw}
                  </pre>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}

// "Copy all" — dumps the entire log to the clipboard in a chat-friendly
// markdown format (timestamp + summary + fenced JSON). Click → confirm
// "Copied!" for two seconds, then resets.
function CopyAllButton({ log }: { log: MsgEntry[] }) {
  const [copied, setCopied] = useState(false)
  async function copy() {
    if (log.length === 0) return
    // Oldest-first ordering for readability when pasted back
    const ordered = [...log].reverse()
    const text = ordered.map(m => {
      const ts  = m.at.toLocaleTimeString("en-GB", { hour12: false })
      const sum = m.parsed ? describeMessage(m.parsed) : "(non-JSON)"
      const body = m.parsed ? JSON.stringify(m.parsed, null, 2) : m.raw
      return `* ${ts} ${sum}\n\n\`\`\`json\n${body}\n\`\`\``
    }).join("\n\n")
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // Fallback for any browsers blocking clipboard API
      alert("Couldn't copy automatically — your browser may have blocked clipboard access.")
    }
  }
  return (
    <button
      onClick={copy}
      disabled={log.length === 0}
      className="text-xs text-blue-600 hover:text-blue-800 disabled:opacity-40 disabled:cursor-not-allowed"
      title={`Copy all ${log.length} message${log.length === 1 ? "" : "s"} to clipboard`}
    >
      {copied ? "✓ Copied" : `📋 Copy all (${log.length})`}
    </button>
  )
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div>
      <p className="text-[10px] text-gray-500 uppercase tracking-wider mb-0.5">{label}</p>
      <p className="text-sm text-gray-800 font-medium">{value}</p>
    </div>
  )
}

function formatAgo(ms: number): string {
  if (ms < 1000) return "just now"
  const s = Math.floor(ms / 1000)
  if (s < 60) return `${s}s ago`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ${s % 60}s ago`
  const h = Math.floor(m / 60)
  return `${h}h ${m % 60}m ago`
}

// Friendly one-liner summary for the log row. Highlights key events.
function describeMessage(obj: any): string {
  if (!obj || typeof obj !== "object") return String(obj)
  const cmd = typeof obj.command === "string" ? obj.command : null
  const c   = obj.content ?? {}

  if (cmd === "liveBidEvent") {
    const lot = c.lot_id, amt = c.amount, ask = c.asking, plat = c.platform
    return `Bid · lot ${lot} · £${amt} (asking £${ask})${plat ? ` · ${plat}` : ""}`
  }
  if (cmd === "sensorNetworkEvent") {
    return `Sensor · ${c.sensor_name ?? "?"} = ${c.sensor_value}`
  }
  if (cmd === "getFairWarningStatus") {
    const flags: string[] = []
    if (c.paused)        flags.push("PAUSED")
    if (c.fair_warning)  flags.push("FAIR WARNING")
    if (c.bid_quicker)   flags.push("BID QUICKER")
    if (c.message)       flags.push("MESSAGE")
    return `Sale state · ${flags.length ? flags.join(" + ") : "normal"}`
  }
  if (cmd === "activeLotLock") {
    return `Lot lock · status ${c.status}`
  }
  if (cmd) return cmd
  const keys = Object.keys(obj).slice(0, 5).join(", ")
  return `{${keys}${Object.keys(obj).length > 5 ? ", …" : ""}}`
}

// Extract structured auction state from the message log. We scan from most-
// recent backwards because the log is newest-first; first event of each type
// we see gives us the current state.
function extractAuctionState(log: MsgEntry[]) {
  let currentLotId: number | string | null = null
  let currentBid:   number | null          = null
  let askingBid:    number | null          = null
  let winner:       number | string | null = null
  let platform:     string | null          = null
  let lastBidAt:    Date | null             = null
  let bidsThisLot:  number                  = 0
  const lotsSet = new Set<string>()

  // Sale state — flags from getFairWarningStatus
  let paused      = false
  let fairWarning = false
  let bidQuicker  = false
  let saleMessage = false
  let saleStateAt: Date | null = null

  // Lot lock — status from activeLotLock
  let lotLockStatus: number | null = null
  let lotLockAt:     Date | null   = null

  // Platform breakdown counts (Online / BSCB / Vectis Live / etc)
  const platformCounts: Record<string, number> = {}

  // First pass — newest liveBidEvent for current state
  for (const m of log) {
    if (m.parsed?.command !== "liveBidEvent") continue
    const c = m.parsed.content ?? {}
    currentLotId = c.lot_id ?? null
    currentBid   = typeof c.amount  === "number" ? c.amount  : null
    askingBid    = typeof c.asking  === "number" ? c.asking  : null
    winner       = c.winner ?? null
    platform     = typeof c.platform === "string" ? c.platform : null
    lastBidAt    = m.at
    break
  }

  // Find latest sale-state event
  for (const m of log) {
    if (m.parsed?.command !== "getFairWarningStatus") continue
    const c = m.parsed.content ?? {}
    paused      = !!c.paused
    fairWarning = !!c.fair_warning
    bidQuicker  = !!c.bid_quicker
    saleMessage = !!c.message
    saleStateAt = m.at
    break
  }

  // Find latest lot-lock event
  for (const m of log) {
    if (m.parsed?.command !== "activeLotLock") continue
    const c = m.parsed.content ?? {}
    lotLockStatus = typeof c.status === "number" ? c.status : null
    lotLockAt     = m.at
    break
  }

  // Second pass — counts on the current lot, distinct lots, platform tallies
  for (const m of log) {
    if (m.parsed?.command !== "liveBidEvent") continue
    const lot = m.parsed.content?.lot_id
    const plat = m.parsed.content?.platform
    if (lot != null) lotsSet.add(String(lot))
    if (lot != null && currentLotId != null && String(lot) === String(currentLotId)) {
      bidsThisLot++
    }
    if (typeof plat === "string" && plat) {
      platformCounts[plat] = (platformCounts[plat] ?? 0) + 1
    }
  }

  return {
    currentLotId,
    currentBid,
    askingBid,
    winner,
    platform,
    lastBidAt,
    bidsThisLot,
    lotsSeen: lotsSet.size,
    paused,
    fairWarning,
    bidQuicker,
    saleMessage,
    saleStateAt,
    lotLockStatus,
    lotLockAt,
    platformCounts,
  }
}
