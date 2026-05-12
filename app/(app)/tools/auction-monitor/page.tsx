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

// ── Alert rules ──────────────────────────────────────────────────────────────
// User-toggleable notification rules. Each rule has a unique id, a sensible
// default, and optionally a configurable threshold (e.g. stall seconds, high-
// value price). The rules engine in the effect below dispatches a push to
// ntfy whenever a rule's condition transitions from false→true.
type AlertRule = {
  id:           string
  label:        string
  description:  string
  defaultOn:    boolean
  threshold?: {
    label:    string
    suffix:   string
    default:  number
    min:      number
    max:      number
  }
}

const ALERT_RULES: AlertRule[] = [
  {
    id:          "connection_drop",
    label:       "Connection dropped",
    description: "WebSocket disconnected unexpectedly (urgent — feed is gone)",
    defaultOn:   true,
  },
  {
    id:          "stall_red",
    label:       "Auction stalled — long silence",
    description: "No bids in the last N seconds (raise urgent alert)",
    defaultOn:   true,
    threshold:   { label: "Seconds", suffix: "s", default: 120, min: 30, max: 600 },
  },
  {
    id:          "stall_amber",
    label:       "Auction quiet — early warning",
    description: "No bids in the last N seconds (heads-up only)",
    defaultOn:   false,
    threshold:   { label: "Seconds", suffix: "s", default: 60, min: 15, max: 300 },
  },
  {
    id:          "paused",
    label:       "Auction paused",
    description: "Auctioneer paused the sale",
    defaultOn:   true,
  },
  {
    id:          "bid_quicker",
    label:       "Bid quicker requested",
    description: "Auctioneer asked the room to bid faster",
    defaultOn:   true,
  },
  {
    id:          "fair_warning",
    label:       "Fair warning called",
    description: "Auctioneer about to hammer (fires every lot — usually off)",
    defaultOn:   false,
  },
  {
    id:          "recovery",
    label:       "Auction recovered",
    description: "Came back to live & active after an amber/red state",
    defaultOn:   true,
  },
  {
    id:          "high_value_sold",
    label:       "High-value lot sold",
    description: "Hammer price above your threshold",
    defaultOn:   false,
    threshold:   { label: "£", suffix: "", default: 1000, min: 100, max: 50000 },
  },
  {
    id:          "lot_passed",
    label:       "Lot passed / unsold",
    description: "Any lot that didn't sell",
    defaultOn:   false,
  },
  {
    id:          "heartbeat",
    label:       "Periodic heartbeat",
    description: "Confirms the monitor is still running (every N minutes)",
    defaultOn:   false,
    threshold:   { label: "Minutes", suffix: "m", default: 15, min: 5, max: 240 },
  },
]

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

  // Push notifications via ntfy.sh — both topic and enabled flag persist
  const [ntfyTopic, setNtfyTopic] = useState<string>(() => {
    if (typeof window === "undefined") return ""
    return localStorage.getItem("auction_monitor_ntfy_topic") ?? ""
  })
  const [pushEnabled, setPushEnabled] = useState<boolean>(() => {
    if (typeof window === "undefined") return false
    return localStorage.getItem("auction_monitor_push_enabled") === "1"
  })
  const [pushStatus, setPushStatus] = useState<string | null>(null)
  // Per-rule enabled flags + thresholds, persisted to localStorage
  const [ruleEnabled, setRuleEnabled] = useState<Record<string, boolean>>(() => {
    if (typeof window === "undefined") return Object.fromEntries(ALERT_RULES.map(r => [r.id, r.defaultOn]))
    try {
      const raw = localStorage.getItem("auction_monitor_rules_enabled")
      const parsed = raw ? JSON.parse(raw) : null
      const out: Record<string, boolean> = {}
      for (const r of ALERT_RULES) out[r.id] = parsed?.[r.id] ?? r.defaultOn
      return out
    } catch {
      return Object.fromEntries(ALERT_RULES.map(r => [r.id, r.defaultOn]))
    }
  })
  const [ruleThresholds, setRuleThresholds] = useState<Record<string, number>>(() => {
    if (typeof window === "undefined") return Object.fromEntries(ALERT_RULES.filter(r => r.threshold).map(r => [r.id, r.threshold!.default]))
    try {
      const raw = localStorage.getItem("auction_monitor_rule_thresholds")
      const parsed = raw ? JSON.parse(raw) : null
      const out: Record<string, number> = {}
      for (const r of ALERT_RULES) {
        if (r.threshold) out[r.id] = parsed?.[r.id] ?? r.threshold.default
      }
      return out
    } catch {
      return Object.fromEntries(ALERT_RULES.filter(r => r.threshold).map(r => [r.id, r.threshold!.default]))
    }
  })
  const [showRuleSettings, setShowRuleSettings] = useState(false)

  function setRuleEnabledPersisted(id: string, enabled: boolean) {
    setRuleEnabled(prev => {
      const next = { ...prev, [id]: enabled }
      try { localStorage.setItem("auction_monitor_rules_enabled", JSON.stringify(next)) } catch {}
      return next
    })
  }
  function setRuleThresholdPersisted(id: string, value: number) {
    setRuleThresholds(prev => {
      const next = { ...prev, [id]: value }
      try { localStorage.setItem("auction_monitor_rule_thresholds", JSON.stringify(next)) } catch {}
      return next
    })
  }

  // Dedupe state per rule — tracks whether the rule's condition is currently
  // "active" so we only fire ONE push per crossing, not one per render.
  const ruleActiveRef = useRef<Record<string, boolean>>({})
  const lastHighValueLotRef = useRef<string | null>(null)
  const lastPassedLotRef    = useRef<string | null>(null)

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
    // Reset all rule-engine dedupe state so the first state after Start
    // is treated as a fresh transition rather than being silently swallowed.
    ruleActiveRef.current     = {}
    lastHighValueLotRef.current = null
    lastPassedLotRef.current    = null
    setRunning(true)
  }
  function stop() {
    setRunning(false)
  }

  // Push to ntfy.sh — accepts any topic, no auth needed.
  // Uses the JSON-body publish format so we don't need custom headers
  // (which would trigger a CORS preflight that ntfy.sh's response doesn't
  // accept). POSTing application/json to https://ntfy.sh works cross-origin.
  async function sendNtfy(opts: {
    title:    string
    body:     string
    priority?: 1 | 2 | 3 | 4 | 5
    tags?:    string[]
  }) {
    const topic = ntfyTopic.trim()
    if (!topic) return false
    try {
      const res = await fetch(`https://ntfy.sh`, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({
          topic,
          title:    opts.title,
          message:  opts.body,
          priority: opts.priority ?? 3,
          tags:     opts.tags ?? [],
        }),
      })
      return res.ok
    } catch {
      return false
    }
  }

  async function sendTestNotification() {
    if (!ntfyTopic.trim()) {
      setPushStatus("Set a topic first")
      return
    }
    const ok = await sendNtfy({
      title:    "Vectis Auction Monitor — test",
      body:     `If you see this on your phone, alerts are set up correctly. Topic: ${ntfyTopic.trim()}`,
      priority: 3,
      tags:     ["white_check_mark"],
    })
    setPushStatus(ok ? "✓ Test sent — check your phone" : "Failed to send (network?)")
    setTimeout(() => setPushStatus(null), 5000)
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

  // Rule-based notification engine. Each rule has dedupe state in
  // ruleActiveRef so we only push ONCE per crossing of the condition.
  useEffect(() => {
    if (!running || !pushEnabled || !ntfyTopic.trim()) return
    const lotInfo = state.currentLotNumber ? ` · Lot ${state.currentLotNumber}` : ""
    const auctionInfo = `Auction ${auctionId}`

    // Helper — fires once on transition from inactive→active, plus an
    // optional "all-clear" message on active→inactive.
    function checkRule(
      ruleId: string,
      active: boolean,
      onActive: () => Parameters<typeof sendNtfy>[0],
    ) {
      if (!ruleEnabled[ruleId]) {
        ruleActiveRef.current[ruleId] = false
        return
      }
      const wasActive = !!ruleActiveRef.current[ruleId]
      if (active && !wasActive) {
        sendNtfy(onActive()).catch(() => {})
      }
      ruleActiveRef.current[ruleId] = active
    }

    // 1. Connection dropped
    checkRule(
      "connection_drop",
      connState === "closed" || connState === "error",
      () => ({
        title:    "Auction alert · Connection dropped",
        body:     `WebSocket ${connState}${lotInfo}\n${auctionInfo}`,
        priority: 5, tags: ["rotating_light"],
      }),
    )

    // 2. Stall — red (long silence)
    const stallRedSec  = ruleThresholds["stall_red"]  ?? 120
    const stallRedActive = connState === "open" && msSinceLastBid !== null && msSinceLastBid >= stallRedSec * 1000
    checkRule(
      "stall_red",
      stallRedActive,
      () => ({
        title:    "Auction alert · No bids",
        body:     `No bid activity for ${stallRedSec}+ seconds${lotInfo}\n${auctionInfo}`,
        priority: 5, tags: ["rotating_light"],
      }),
    )

    // 3. Stall — amber (early warning)
    const stallAmberSec = ruleThresholds["stall_amber"] ?? 60
    const stallAmberActive = connState === "open" && msSinceLastBid !== null && msSinceLastBid >= stallAmberSec * 1000 && !stallRedActive
    checkRule(
      "stall_amber",
      stallAmberActive,
      () => ({
        title:    "Auction warning · Quiet",
        body:     `No bids in last ${stallAmberSec} seconds${lotInfo}\n${auctionInfo}`,
        priority: 4, tags: ["warning"],
      }),
    )

    // 4. Paused
    checkRule(
      "paused",
      state.paused,
      () => ({
        title:    "Auction paused",
        body:     `Auctioneer paused the sale${lotInfo}\n${auctionInfo}`,
        priority: 4, tags: ["pause_button"],
      }),
    )

    // 5. Bid quicker
    checkRule(
      "bid_quicker",
      state.bidQuicker,
      () => ({
        title:    "Auctioneer: bid quicker",
        body:     `Auctioneer asking for faster bids${lotInfo}\n${auctionInfo}`,
        priority: 4, tags: ["zap"],
      }),
    )

    // 6. Fair warning
    checkRule(
      "fair_warning",
      state.fairWarning,
      () => ({
        title:    "Fair warning called",
        body:     `Auctioneer about to hammer${lotInfo}\n${auctionInfo}`,
        priority: 3, tags: ["hammer"],
      }),
    )

    // 7. Recovery — fires when the headline band returns to green after
    //    being amber/red. Tracked off the overall health band, not a single rule.
    const recoveryActive = healthBand === "green" && (
      ruleActiveRef.current["__bad_state__"]
    )
    if (healthBand !== "green" && (healthBand === "amber" || healthBand === "red")) {
      ruleActiveRef.current["__bad_state__"] = true
    } else if (healthBand === "green") {
      if (ruleActiveRef.current["__bad_state__"] && ruleEnabled["recovery"]) {
        sendNtfy({
          title:    "Auction recovered",
          body:     `Back to live & active${lotInfo}\n${auctionInfo}`,
          priority: 3, tags: ["white_check_mark"],
        }).catch(() => {})
      }
      ruleActiveRef.current["__bad_state__"] = false
    }

    // 8. High-value lot sold — fires once per qualifying lot
    if (ruleEnabled["high_value_sold"]) {
      const threshold = ruleThresholds["high_value_sold"] ?? 1000
      const recent = state.recentLots[0]   // newest finished lot
      if (recent && recent.hammerPrice != null && recent.hammerPrice >= threshold) {
        const key = `${recent.lotId}-${recent.hammerPrice}`
        if (lastHighValueLotRef.current !== key) {
          lastHighValueLotRef.current = key
          sendNtfy({
            title:    `High-value sold · £${recent.hammerPrice.toLocaleString()}`,
            body:     `Lot ${recent.lotNumber ?? recent.lotId} hammered at £${recent.hammerPrice.toLocaleString()}\n${auctionInfo}`,
            priority: 3, tags: ["moneybag"],
          }).catch(() => {})
        }
      }
    }

    // 9. Lot passed
    if (ruleEnabled["lot_passed"]) {
      const recent = state.recentLots[0]
      if (recent && /pass|unsold|withdrawn/i.test(recent.outcome ?? "")) {
        const key = `${recent.lotId}-${recent.outcome}`
        if (lastPassedLotRef.current !== key) {
          lastPassedLotRef.current = key
          sendNtfy({
            title:    `Lot ${recent.outcome ?? "passed"}`,
            body:     `Lot ${recent.lotNumber ?? recent.lotId} — ${recent.outcome}\n${auctionInfo}`,
            priority: 2, tags: ["arrow_right"],
          }).catch(() => {})
        }
      }
    }

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [healthBand, healthLabel, connState, msSinceLastBid, state.paused, state.fairWarning, state.bidQuicker, state.recentLots.length, running, pushEnabled])

  // 10. Heartbeat — fires on a timer if enabled
  useEffect(() => {
    if (!running || !pushEnabled || !ntfyTopic.trim()) return
    if (!ruleEnabled["heartbeat"]) return
    const minutes = ruleThresholds["heartbeat"] ?? 15
    const intervalMs = Math.max(1, minutes) * 60_000
    const id = setInterval(() => {
      const lotInfo = state.currentLotNumber ? ` · Lot ${state.currentLotNumber}` : ""
      sendNtfy({
        title:    "Auction monitor heartbeat",
        body:     `Still running · ${state.soldCount} sold so far${lotInfo}\nAuction ${auctionId}`,
        priority: 1, tags: ["green_heart"],
      }).catch(() => {})
    }, intervalMs)
    return () => clearInterval(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running, pushEnabled, ruleEnabled["heartbeat"], ruleThresholds["heartbeat"]])

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

      {/* Phone notifications via ntfy.sh */}
      <div className="bg-white rounded-xl border border-gray-200 p-4 mb-6">
        <div className="flex items-start justify-between gap-3 mb-3 flex-wrap">
          <div>
            <h3 className="text-sm font-semibold text-gray-700">📱 Phone notifications</h3>
            <p className="text-[11px] text-gray-500 mt-0.5">
              Pushes via <a href="https://ntfy.sh" target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">ntfy.sh</a> — install the free ntfy app on your phone, subscribe to your topic, alerts arrive instantly.
            </p>
          </div>
          <label className="text-xs text-gray-600 flex items-center gap-1.5 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={pushEnabled}
              onChange={e => {
                setPushEnabled(e.target.checked)
                localStorage.setItem("auction_monitor_push_enabled", e.target.checked ? "1" : "0")
              }}
              className="w-4 h-4 accent-emerald-600"
            />
            Enable
          </label>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex-1 min-w-[200px]">
            <label className="block text-[11px] text-gray-500 mb-1">ntfy topic</label>
            <input
              type="text"
              value={ntfyTopic}
              onChange={e => {
                setNtfyTopic(e.target.value)
                localStorage.setItem("auction_monitor_ntfy_topic", e.target.value)
              }}
              placeholder="e.g. vectis-auction-alerts_JJ"
              className="w-full rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-emerald-500"
            />
          </div>
          <button
            onClick={sendTestNotification}
            disabled={!ntfyTopic.trim()}
            className="self-end bg-emerald-600 hover:bg-emerald-700 disabled:opacity-40 text-white text-xs font-semibold px-3 py-1.5 rounded-lg"
          >Send test</button>
          {pushStatus && (
            <span className="self-end text-xs text-gray-600">{pushStatus}</span>
          )}
        </div>
        <div className="mt-3 pt-3 border-t border-gray-100">
          <button
            onClick={() => setShowRuleSettings(s => !s)}
            className="text-xs text-blue-600 hover:text-blue-800 font-medium"
          >
            {showRuleSettings ? "▼ Hide alert rules" : "▶ Configure alert rules"}
            <span className="ml-2 text-gray-500 font-normal">
              ({Object.values(ruleEnabled).filter(Boolean).length} of {ALERT_RULES.length} enabled)
            </span>
          </button>
          {showRuleSettings && (
            <ul className="mt-3 space-y-2">
              {ALERT_RULES.map(rule => {
                const enabled  = !!ruleEnabled[rule.id]
                const threshold = ruleThresholds[rule.id]
                return (
                  <li key={rule.id} className={`flex items-start gap-3 p-2.5 rounded-lg border ${enabled ? "border-emerald-200 bg-emerald-50/40" : "border-gray-200 bg-gray-50/40"}`}>
                    <input
                      type="checkbox"
                      checked={enabled}
                      onChange={e => setRuleEnabledPersisted(rule.id, e.target.checked)}
                      className="mt-1 w-4 h-4 accent-emerald-600 flex-shrink-0"
                    />
                    <div className="flex-1">
                      <p className="text-sm font-medium text-gray-800">{rule.label}</p>
                      <p className="text-[11px] text-gray-500 mt-0.5">{rule.description}</p>
                    </div>
                    {rule.threshold && (
                      <div className="flex items-center gap-1.5 self-center">
                        <span className="text-[11px] text-gray-500">{rule.threshold.label}</span>
                        <input
                          type="number"
                          value={threshold ?? rule.threshold.default}
                          min={rule.threshold.min}
                          max={rule.threshold.max}
                          onChange={e => setRuleThresholdPersisted(rule.id, Math.max(rule.threshold!.min, Math.min(rule.threshold!.max, Number(e.target.value) || rule.threshold!.default)))}
                          disabled={!enabled}
                          className="w-20 text-xs border border-gray-300 rounded px-2 py-1 text-right disabled:bg-gray-100 disabled:text-gray-400 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                        />
                        {rule.threshold.suffix && <span className="text-[11px] text-gray-500">{rule.threshold.suffix}</span>}
                      </div>
                    )}
                  </li>
                )
              })}
            </ul>
          )}
        </div>
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
              <Stat
                label="Current lot"
                value={state.currentLotNumber ? `Lot ${state.currentLotNumber}` : `#${state.currentLotId}`}
              />
              <Stat label="Current bid"  value={state.currentBid  != null ? `£${state.currentBid.toLocaleString()}`  : "—"} />
              <Stat label="Asking bid"   value={state.askingBid   != null ? `£${state.askingBid.toLocaleString()}`   : "—"} />
              <Stat label="Winning paddle" value={
                state.winner === 0 ? "Saleroom" : state.winner != null ? String(state.winner) : "—"
              } />
              <Stat label="Platform"     value={state.platform ?? "—"} />
            </div>
            <div className="mt-3 grid grid-cols-2 sm:grid-cols-5 gap-3 text-sm">
              <Stat label="Last bid" value={state.lastBidAt ? formatAgo(now.getTime() - state.lastBidAt.getTime()) : "—"} />
              <Stat label="Bids on this lot" value={state.bidsThisLot.toLocaleString()} />
              <Stat label="Lots sold this session" value={state.soldCount.toLocaleString()} />
              <Stat label="Lots passed" value={state.passedCount.toLocaleString()} />
              <Stat label="Session hammer" value={`£${state.sessionHammer.toLocaleString()}`} />
            </div>
            <div className="mt-3 grid grid-cols-1 sm:grid-cols-3 gap-3 text-sm">
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

      {/* Recent lots — newest-first list of finished lots in this session */}
      {state.recentLots.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden mb-6">
          <div className="px-4 py-3 border-b border-gray-100">
            <h3 className="text-sm font-semibold text-gray-700">Recent lots ({state.recentLots.length})</h3>
            <p className="text-[11px] text-gray-500 mt-0.5">Newest first · {state.soldCount} sold · {state.passedCount} passed · £{state.sessionHammer.toLocaleString()} total hammer</p>
          </div>
          <ul className="divide-y divide-gray-100">
            {state.recentLots.map((lot, i) => {
              const isSold     = /sold/i.test(lot.outcome ?? "")
              const isPassed   = /pass|unsold|withdrawn/i.test(lot.outcome ?? "")
              const badgeClass = isSold
                ? "bg-emerald-100 text-emerald-800 border-emerald-300"
                : isPassed
                  ? "bg-gray-100 text-gray-700 border-gray-300"
                  : "bg-blue-100 text-blue-700 border-blue-300"
              return (
                <li key={i} className="px-4 py-2.5 flex items-center gap-3 text-sm">
                  <span className="font-mono font-semibold text-gray-700 min-w-[60px]">
                    {lot.lotNumber ? `Lot ${lot.lotNumber}` : `#${lot.lotId}`}
                  </span>
                  <span className={`text-[11px] font-semibold border px-2 py-0.5 rounded uppercase tracking-wide ${badgeClass}`}>
                    {lot.outcome ?? "?"}
                  </span>
                  <span className="flex-1" />
                  <span className="text-gray-600 font-mono">
                    {lot.hammerPrice != null ? `£${lot.hammerPrice.toLocaleString()}` : "—"}
                  </span>
                  <span className="text-[11px] text-gray-400 min-w-[60px] text-right">
                    {lot.at.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}
                  </span>
                </li>
              )
            })}
          </ul>
        </div>
      )}

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
  if (cmd === "activeLotChange") {
    const newLot = c.lot_number ? `Lot ${c.lot_number}` : `#${c.lot_id}`
    return `Lot advance → ${newLot}${c.previous_lot_type ? ` (previous: ${c.previous_lot_type})` : ""}`
  }
  if (cmd === "lotInformationUpdate") {
    return `Lot info · ${c.lot_id} · ${c.key_name}=${c.key_value}${c.hammer_price ? ` · hammer £${c.hammer_price}` : ""}`
  }
  if (cmd === "liveCommissionBidEvent") {
    return `Commission bid · lot ${c.lot_id} · max £${c.amount} (executed £${c.executed_amount}) · paddle ${c.user_id}`
  }
  if (cmd === "undoLiveBid") {
    return `Bid UNDONE · lot ${c.lot_id} · was £${c.amount}`
  }
  if (cmd === "undoneBidChange") {
    return `Bid-change undo · lot ${c.bid_lot_id} · paddle ${c.bid_user_id}`
  }
  if (cmd === "liveActiveReload") {
    return `Server reload signal`
  }
  if (cmd) return cmd
  const keys = Object.keys(obj).slice(0, 5).join(", ")
  return `{${keys}${Object.keys(obj).length > 5 ? ", …" : ""}}`
}

// Per-lot result tracked from activeLotChange + lotInformationUpdate
export type LotResult = {
  lotId:       number | string
  lotNumber:   string | null    // human-friendly, e.g. "325"
  outcome:     string | null    // "Sold" | "Passed" | "Withdrawn" | …
  hammerPrice: number | null
  at:          Date
}

// Extract structured auction state from the message log. We scan from most-
// recent backwards because the log is newest-first; first event of each type
// we see gives us the current state.
function extractAuctionState(log: MsgEntry[]) {
  let currentLotId:     number | string | null = null
  let currentLotNumber: string | null          = null
  let currentBid:       number | null          = null
  let askingBid:        number | null          = null
  let winner:           number | string | null = null
  let platform:         string | null          = null
  let lastBidAt:        Date | null             = null
  let bidsThisLot:      number                  = 0
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

  // Platform breakdown counts (Online / BSCB / Saleroom / …)
  const platformCounts: Record<string, number> = {}

  // Lot results from activeLotChange + lotInformationUpdate
  // activeLotChange tells us a lot has finished and what its outcome was.
  // lotInformationUpdate carries the hammer_price for that finished lot.
  // We match them by lot_id.
  const lotNumberByLotId: Record<string, string>  = {}
  const hammerByLotId:    Record<string, number>  = {}
  const lotOutcomes:      LotResult[]             = []

  // 1. Latest liveBidEvent for current state (we walk newest first and
  //    take the first match — but we skip events that were later undone)
  const undoneBidLots = new Set<string>()  // lot_ids of bids that have been undone
  for (const m of log) {
    if (m.parsed?.command !== "undoLiveBid") continue
    const lid = m.parsed.content?.lot_id
    if (lid != null) undoneBidLots.add(String(lid) + "-" + (m.parsed.content?.amount ?? "?"))
  }

  for (const m of log) {
    if (m.parsed?.command !== "liveBidEvent") continue
    const c = m.parsed.content ?? {}
    // Skip a bid that was subsequently undone with the same lot+amount
    if (undoneBidLots.has(String(c.lot_id) + "-" + c.amount)) continue
    currentLotId = c.lot_id ?? null
    currentBid   = typeof c.amount  === "number" ? c.amount  : null
    askingBid    = typeof c.asking  === "number" ? c.asking  : null
    winner       = c.winner ?? null
    platform     = typeof c.platform === "string" ? c.platform : null
    lastBidAt    = m.at
    break
  }

  // 2. Sale state (latest)
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

  // 3. Lot lock (latest)
  for (const m of log) {
    if (m.parsed?.command !== "activeLotLock") continue
    const c = m.parsed.content ?? {}
    lotLockStatus = typeof c.status === "number" ? c.status : null
    lotLockAt     = m.at
    break
  }

  // 4. Walk the WHOLE log oldest-first for cumulative counters
  const logOldestFirst = [...log].reverse()
  for (const m of logOldestFirst) {
    const cmd = m.parsed?.command
    const c   = m.parsed?.content ?? {}

    if (cmd === "liveBidEvent") {
      // Skip undone ones (they shouldn't count in totals)
      if (undoneBidLots.has(String(c.lot_id) + "-" + c.amount)) continue
      const lot = c.lot_id
      const plat = c.platform
      if (lot != null) lotsSet.add(String(lot))
      if (typeof plat === "string" && plat) {
        platformCounts[plat] = (platformCounts[plat] ?? 0) + 1
      }
    }

    if (cmd === "activeLotChange") {
      // The PREVIOUS lot has just finished. Record its outcome.
      // c.update_previous_lot signals whether to attribute previous_lot_type.
      // For the NEW current lot we get lot_id + lot_number.
      if (c.update_previous_lot && c.lot_id != null && c.previous_lot_type) {
        // The previous lot is whatever was current immediately before this event
        // — we infer it by walking back to find the last activeLotChange or the
        // first liveBidEvent's lot_id. Simpler: record by previous "current lot"
        // tracker.
        const prevLot = prevLotIdAtTimeOf(logOldestFirst, m)
        if (prevLot != null) {
          lotOutcomes.push({
            lotId:       prevLot,
            lotNumber:   lotNumberByLotId[String(prevLot)] ?? null,
            outcome:     String(c.previous_lot_type),
            hammerPrice: hammerByLotId[String(prevLot)] ?? null,
            at:          m.at,
          })
        }
      }
      // Remember the human lot number for this lot_id
      if (c.lot_id != null && c.lot_number) {
        lotNumberByLotId[String(c.lot_id)] = String(c.lot_number)
      }
    }

    if (cmd === "lotInformationUpdate") {
      // Hammer price for a specific lot
      if (c.lot_id != null && c.hammer_price != null) {
        const hp = parseFloat(String(c.hammer_price))
        if (!isNaN(hp)) hammerByLotId[String(c.lot_id)] = hp
        // Update any already-recorded outcome with the hammer price
        for (const o of lotOutcomes) {
          if (String(o.lotId) === String(c.lot_id) && o.hammerPrice == null) {
            o.hammerPrice = hp
          }
        }
      }
    }
  }

  // Fill in the human lot number for the currently active lot
  if (currentLotId != null) {
    currentLotNumber = lotNumberByLotId[String(currentLotId)] ?? null
  }

  // Count bids on current lot (post-undo)
  for (const m of log) {
    if (m.parsed?.command !== "liveBidEvent") continue
    const c = m.parsed.content
    if (undoneBidLots.has(String(c?.lot_id) + "-" + c?.amount)) continue
    if (c?.lot_id != null && currentLotId != null && String(c.lot_id) === String(currentLotId)) {
      bidsThisLot++
    }
  }

  // Session totals
  const soldCount = lotOutcomes.filter(o => /sold/i.test(o.outcome ?? "")).length
  const passedCount = lotOutcomes.filter(o => /pass|unsold|withdrawn/i.test(o.outcome ?? "")).length
  const sessionHammer = lotOutcomes.reduce((s, o) => s + (o.hammerPrice ?? 0), 0)

  // Recent lots (newest first), limit to 10
  const recentLots = [...lotOutcomes].reverse().slice(0, 10)

  return {
    currentLotId,
    currentLotNumber,
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
    recentLots,
    soldCount,
    passedCount,
    sessionHammer,
  }
}

// Walk the log (oldest first) up to the given message; return the most recent
// active-lot id seen before that point (from either an earlier activeLotChange
// or a liveBidEvent's lot_id).
function prevLotIdAtTimeOf(logOldestFirst: MsgEntry[], target: MsgEntry): string | number | null {
  let last: string | number | null = null
  for (const m of logOldestFirst) {
    if (m === target) break
    const cmd = m.parsed?.command
    const c   = m.parsed?.content ?? {}
    if (cmd === "activeLotChange" && c.lot_id != null) last = c.lot_id
    else if (cmd === "liveBidEvent" && c.lot_id != null && last == null) last = c.lot_id
  }
  return last
}
