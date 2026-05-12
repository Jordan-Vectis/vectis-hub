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

  // Status derivation
  const msSinceLast = lastMessageAt ? now.getTime() - lastMessageAt.getTime() : null
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
      healthBand = "red"
      healthLabel = "No messages for over 2 minutes — auction may be stuck"
    } else if (msSinceLast > STALE_AMBER_MS) {
      healthBand = "amber"
      healthLabel = "No messages for 30+ seconds — keep an eye on it"
    } else {
      healthBand = "green"
      healthLabel = "Live and active"
    }
  }

  // Heuristic parse — try to pull common fields out of recent messages.
  // We don't know the exact protocol yet, so look at any object and grab
  // anything that looks like a lot number, bid amount or time field.
  const heuristics = extractHeuristics(log)

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

        {/* Heuristic-parsed fields */}
        {(heuristics.currentLot || heuristics.currentBid || heuristics.timeRemaining) && (
          <div className="mt-4 pt-4 border-t border-gray-100 grid grid-cols-1 sm:grid-cols-3 gap-3 text-sm">
            <Stat label="Current lot (best guess)" value={heuristics.currentLot ?? "—"} />
            <Stat label="Current bid (best guess)" value={heuristics.currentBid ?? "—"} />
            <Stat label="Time remaining (best guess)" value={heuristics.timeRemaining ?? "—"} />
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

// Best-effort summary of an unknown message shape for the log row
function describeMessage(obj: any): string {
  if (obj === null) return "null"
  if (typeof obj !== "object") return String(obj)
  // Look for common event-type fields
  const evtField = ["type", "event", "action", "cmd", "command", "msg"]
    .find(k => typeof obj[k] === "string")
  if (evtField) return obj[evtField]
  // Fall back to a compact key list
  const keys = Object.keys(obj).slice(0, 5).join(", ")
  return `{${keys}${Object.keys(obj).length > 5 ? ", …" : ""}}`
}

// Look across the last few messages for anything that could be the current
// lot / bid / time remaining. Once we've seen the real protocol, this gets
// replaced with proper field extraction.
function extractHeuristics(log: MsgEntry[]) {
  const out: { currentLot?: string; currentBid?: string; timeRemaining?: string } = {}
  for (const m of log.slice(0, 30)) {
    const p = m.parsed
    if (!p || typeof p !== "object") continue
    walk(p, (key, value) => {
      const k = key.toLowerCase()
      if (!out.currentLot && /(^|_)lot(no|number|num)?$/.test(k) && (typeof value === "string" || typeof value === "number")) {
        out.currentLot = String(value)
      }
      if (!out.currentBid && /(^|_)(current|asking|highest)?[_ ]?bid$/.test(k) && (typeof value === "number" || (typeof value === "string" && /\d/.test(value)))) {
        out.currentBid = typeof value === "number" ? `£${value}` : String(value)
      }
      if (!out.timeRemaining && /(time|countdown|remaining|seconds)/.test(k) && (typeof value === "number")) {
        out.timeRemaining = `${value}s`
      }
    })
    if (out.currentLot && out.currentBid && out.timeRemaining) break
  }
  return out
}

function walk(obj: any, fn: (key: string, value: any) => void) {
  if (obj === null || typeof obj !== "object") return
  for (const [k, v] of Object.entries(obj)) {
    fn(k, v)
    if (v && typeof v === "object") walk(v, fn)
  }
}
