"use client"

import { useEffect, useRef, useState } from "react"

// Auction Monitor — v2  (Live + Timed tabs)
// Live tab:  connects to wss://www.vectis.co.uk/wss/{auctionId}
//            ID found in the bidstream URL:  …com_bidstream&id=1386
// Timed tab: connects to the same WSS endpoint but uses the numeric ID
//            from the end of the public bidding URL:
//            …vectis.co.uk/bidding/F067-...-timed-1399  →  id = 1399
//
// The timed tab includes a "Commands seen" discovery panel so we can
// learn the timed-auction event protocol on the first live session.

type MsgEntry = {
  at:     Date
  raw:    string
  parsed: any
}

type ConnState = "idle" | "connecting" | "open" | "closing" | "closed" | "error"

const WS_TEMPLATE        = "wss://www.vectis.co.uk/wss/{id}"
const RECONNECT_DELAY_MS = 5000
const STALE_AMBER_MS     = 30_000
const STALE_RED_MS       = 120_000
const MAX_LOG_ROWS       = 500
const MAX_LOT_OUTCOMES   = 2000

// ── Alert rules ───────────────────────────────────────────────────────────────
type AlertRule = {
  id:          string
  label:       string
  description: string
  defaultOn:   boolean
  threshold?: {
    label:   string
    suffix:  string
    default: number
    min:     number
    max:     number
  }
}

const ALERT_RULES: AlertRule[] = [
  {
    id: "connection_drop", label: "Connection dropped",
    description: "WebSocket disconnected unexpectedly (urgent — feed is gone)",
    defaultOn: true,
  },
  {
    id: "stall_red", label: "Auction stalled — long silence",
    description: "No bids in the last N seconds (raise urgent alert)",
    defaultOn: true,
    threshold: { label: "Seconds", suffix: "s", default: 120, min: 30, max: 600 },
  },
  {
    id: "stall_amber", label: "Auction quiet — early warning",
    description: "No bids in the last N seconds (heads-up only)",
    defaultOn: false,
    threshold: { label: "Seconds", suffix: "s", default: 60, min: 15, max: 300 },
  },
  {
    id: "paused", label: "Auction paused",
    description: "Auctioneer paused the sale",
    defaultOn: true,
  },
  {
    id: "bid_quicker", label: "Bid quicker requested",
    description: "Auctioneer asked the room to bid faster",
    defaultOn: true,
  },
  {
    id: "fair_warning", label: "Fair warning called",
    description: "Auctioneer about to hammer (fires every lot — usually off)",
    defaultOn: false,
  },
  {
    id: "recovery", label: "Auction recovered",
    description: "Came back to live & active after an amber/red state",
    defaultOn: true,
  },
  {
    id: "high_value_sold", label: "High-value lot sold",
    description: "Hammer price above your threshold",
    defaultOn: false,
    threshold: { label: "£", suffix: "", default: 1000, min: 100, max: 50000 },
  },
  {
    id: "lot_passed", label: "Lot passed / unsold",
    description: "Any lot that didn't sell",
    defaultOn: false,
  },
  {
    id: "heartbeat", label: "Periodic heartbeat",
    description: "Confirms the monitor is still running (every N minutes)",
    defaultOn: false,
    threshold: { label: "Minutes", suffix: "m", default: 15, min: 5, max: 240 },
  },
]

// Timed auction alert rules — simplified set.
// Auctioneer-specific rules (paused, fair warning, bid quicker) don't apply to
// timed auctions. More rules will be added once the event format is confirmed.
const TIMED_ALERT_RULES: AlertRule[] = [
  {
    id: "connection_drop", label: "Connection dropped",
    description: "WebSocket disconnected unexpectedly",
    defaultOn: true,
  },
  {
    id: "stall_red", label: "No activity — long silence",
    description: "No messages in the last N seconds (urgent)",
    defaultOn: true,
    threshold: { label: "Seconds", suffix: "s", default: 120, min: 30, max: 600 },
  },
  {
    id: "stall_amber", label: "Quiet — early warning",
    description: "No messages in the last N seconds (heads-up only)",
    defaultOn: false,
    threshold: { label: "Seconds", suffix: "s", default: 60, min: 15, max: 300 },
  },
  {
    id: "recovery", label: "Auction recovered",
    description: "Back to active after a stall or drop",
    defaultOn: true,
  },
  {
    id: "heartbeat", label: "Periodic heartbeat",
    description: "Confirms the monitor is still running (every N minutes)",
    defaultOn: false,
    threshold: { label: "Minutes", suffix: "m", default: 15, min: 5, max: 240 },
  },
]

export default function AuctionMonitorPage() {

  // ── Tab ──────────────────────────────────────────────────────────────────────
  const [activeTab, setActiveTab] = useState<"live" | "timed">("live")

  // ── Shared clock ─────────────────────────────────────────────────────────────
  const [now, setNow] = useState<Date>(new Date())
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(t)
  }, [])

  // ── Shared ntfy ──────────────────────────────────────────────────────────────
  const [ntfyTopic, setNtfyTopic] = useState<string>(() => {
    if (typeof window === "undefined") return ""
    return localStorage.getItem("auction_monitor_ntfy_topic") ?? ""
  })
  const [pushEnabled, setPushEnabled] = useState<boolean>(() => {
    if (typeof window === "undefined") return false
    return localStorage.getItem("auction_monitor_push_enabled") === "1"
  })
  const [pushStatus, setPushStatus] = useState<string | null>(null)

  async function sendNtfy(opts: {
    title: string; body: string; priority?: 1|2|3|4|5; tags?: string[]
  }) {
    const topic = ntfyTopic.trim()
    if (!topic) return false
    try {
      const res = await fetch("https://ntfy.sh", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ topic, title: opts.title, message: opts.body, priority: opts.priority ?? 3, tags: opts.tags ?? [] }),
      })
      return res.ok
    } catch { return false }
  }

  async function sendTestNotification() {
    if (!ntfyTopic.trim()) { setPushStatus("Set a topic first"); return }
    const ok = await sendNtfy({
      title: "Vectis Auction Monitor — test",
      body:  `If you see this on your phone, alerts are set up correctly. Topic: ${ntfyTopic.trim()}`,
      priority: 3, tags: ["white_check_mark"],
    })
    setPushStatus(ok ? "✓ Test sent — check your phone" : "Failed to send (network?)")
    setTimeout(() => setPushStatus(null), 5000)
  }

  // ════════════════════════════════════════════════════════════════════════════
  // LIVE AUCTION STATE
  // ════════════════════════════════════════════════════════════════════════════

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
  const [allLotOutcomes, setAllLotOutcomes] = useState<LotResult[]>([])
  const [bidCounter, setBidCounter] = useState(0)
  const [undoCounter, setUndoCounter] = useState(0)
  const currentLotIdRef     = useRef<number | string | null>(null)
  const lotNumberByLotIdRef = useRef<Record<string, string>>({})
  const hammerByLotIdRef    = useRef<Record<string, number>>({})

  const [ruleEnabled, setRuleEnabled] = useState<Record<string, boolean>>(() => {
    if (typeof window === "undefined") return Object.fromEntries(ALERT_RULES.map(r => [r.id, r.defaultOn]))
    try {
      const raw = localStorage.getItem("auction_monitor_rules_enabled")
      const parsed = raw ? JSON.parse(raw) : null
      const out: Record<string, boolean> = {}
      for (const r of ALERT_RULES) out[r.id] = parsed?.[r.id] ?? r.defaultOn
      return out
    } catch { return Object.fromEntries(ALERT_RULES.map(r => [r.id, r.defaultOn])) }
  })
  const [ruleThresholds, setRuleThresholds] = useState<Record<string, number>>(() => {
    if (typeof window === "undefined") return Object.fromEntries(ALERT_RULES.filter(r => r.threshold).map(r => [r.id, r.threshold!.default]))
    try {
      const raw = localStorage.getItem("auction_monitor_rule_thresholds")
      const parsed = raw ? JSON.parse(raw) : null
      const out: Record<string, number> = {}
      for (const r of ALERT_RULES) if (r.threshold) out[r.id] = parsed?.[r.id] ?? r.threshold.default
      return out
    } catch { return Object.fromEntries(ALERT_RULES.filter(r => r.threshold).map(r => [r.id, r.threshold!.default])) }
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

  const ruleActiveRef         = useRef<Record<string, boolean>>({})
  const ruleLastFiredRef      = useRef<Record<string, number>>({})
  const lastHighValueLotRef   = useRef<string | null>(null)
  const lastPassedLotRef      = useRef<string | null>(null)
  const wsRef                 = useRef<WebSocket | null>(null)
  const reconnectTimerRef     = useRef<ReturnType<typeof setTimeout> | null>(null)
  const shouldReconnectRef    = useRef(false)

  useEffect(() => {
    if (!running) {
      shouldReconnectRef.current = false
      if (wsRef.current) { try { wsRef.current.close() } catch {}; wsRef.current = null }
      if (reconnectTimerRef.current) { clearTimeout(reconnectTimerRef.current); reconnectTimerRef.current = null }
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
        ws.onopen = () => setConnState("open")
        ws.onmessage = (ev) => {
          const raw = typeof ev.data === "string" ? ev.data : "[binary]"
          let parsed: any = null
          try { parsed = JSON.parse(raw) } catch {}
          const at = new Date()
          setLastMessageAt(at)
          setLog(prev => {
            const next = [{ at, raw, parsed }, ...prev]
            return next.length > MAX_LOG_ROWS ? next.slice(0, MAX_LOG_ROWS) : next
          })
          const cmd = parsed?.command
          const c   = parsed?.content ?? {}
          if (cmd === "liveBidEvent") {
            setBidCounter(n => n + 1)
            if (c.lot_id != null) currentLotIdRef.current = c.lot_id
          }
          if (cmd === "undoLiveBid") setUndoCounter(n => n + 1)
          if (cmd === "activeLotChange") {
            const prev = currentLotIdRef.current
            if (prev != null && c.previous_lot_type) {
              const key = String(prev)
              const lotResult: LotResult = {
                lotId: prev, lotNumber: lotNumberByLotIdRef.current[key] ?? null,
                outcome: String(c.previous_lot_type), hammerPrice: hammerByLotIdRef.current[key] ?? null, at,
              }
              setAllLotOutcomes(prevList => {
                const next = [...prevList, lotResult]
                return next.length > MAX_LOT_OUTCOMES ? next.slice(-MAX_LOT_OUTCOMES) : next
              })
            }
            if (c.lot_id != null && c.lot_number) lotNumberByLotIdRef.current[String(c.lot_id)] = String(c.lot_number)
            currentLotIdRef.current = c.lot_id ?? currentLotIdRef.current
          }
          if (cmd === "lotInformationUpdate") {
            if (c.lot_id != null && c.hammer_price != null) {
              const hp = parseFloat(String(c.hammer_price))
              if (!isNaN(hp)) {
                hammerByLotIdRef.current[String(c.lot_id)] = hp
                setAllLotOutcomes(prevList => prevList.map(o =>
                  String(o.lotId) === String(c.lot_id) && o.hammerPrice == null ? { ...o, hammerPrice: hp } : o
                ))
              }
            }
          }
        }
        ws.onerror = () => setConnState("error")
        ws.onclose = () => {
          wsRef.current = null
          setConnState("closed")
          if (shouldReconnectRef.current) { setReconnects(r => r + 1); reconnectTimerRef.current = setTimeout(openSocket, RECONNECT_DELAY_MS) }
        }
      } catch {
        setConnState("error")
        if (shouldReconnectRef.current) reconnectTimerRef.current = setTimeout(openSocket, RECONNECT_DELAY_MS)
      }
    }
    openSocket()
    return () => {
      shouldReconnectRef.current = false
      if (wsRef.current) { try { wsRef.current.close() } catch {}; wsRef.current = null }
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running, auctionId])

  function start() {
    if (!auctionId.trim()) return
    localStorage.setItem("auction_monitor_id", auctionId.trim())
    setLog([]); setLastMessageAt(null); setReconnects(0)
    setAllLotOutcomes([]); setBidCounter(0); setUndoCounter(0)
    currentLotIdRef.current = null; lotNumberByLotIdRef.current = {}; hammerByLotIdRef.current = {}
    ruleActiveRef.current = {}; ruleLastFiredRef.current = {}; lastHighValueLotRef.current = null; lastPassedLotRef.current = null
    setRunning(true)
  }
  function stop() { setRunning(false) }

  const state          = extractAuctionState(log, allLotOutcomes)
  const msSinceLast    = lastMessageAt ? now.getTime() - lastMessageAt.getTime() : null
  const msSinceLastBid = state.lastBidAt ? now.getTime() - state.lastBidAt.getTime() : null

  // Countdown helpers for live alert rules
  function liveRuleCountdownMs(ruleId: string): number | null {
    if (!running || connState !== "open") return null
    if (ruleId === "stall_red")   return msSinceLastBid !== null ? (ruleThresholds["stall_red"]   ?? 120) * 1000 - msSinceLastBid : null
    if (ruleId === "stall_amber") return msSinceLastBid !== null ? (ruleThresholds["stall_amber"] ??  60) * 1000 - msSinceLastBid : null
    return null
  }

  let healthBand: "green" | "amber" | "red" | "grey" = "grey"
  let healthLabel = "Not started"
  if (running) {
    if (connState !== "open")            { healthBand = "red";   healthLabel = `Connection ${connState}` }
    else if (msSinceLast === null)        { healthBand = "amber"; healthLabel = "Connected — waiting for first message" }
    else if (msSinceLast > STALE_RED_MS) { healthBand = "red";   healthLabel = "No messages for over 2 minutes — feed may have dropped" }
    else if (state.paused)               { healthBand = "amber"; healthLabel = "Auction paused by auctioneer" }
    else if (msSinceLastBid === null)     { healthBand = "amber"; healthLabel = "Connected — waiting for first bid event" }
    else if (msSinceLastBid > STALE_RED_MS)   { healthBand = "red";   healthLabel = "No bid activity for over 2 minutes — auction may be stuck" }
    else if (msSinceLastBid > STALE_AMBER_MS) { healthBand = "amber"; healthLabel = "No bid activity for 30+ seconds — keep an eye on it" }
    else { healthBand = "green"; healthLabel = "Live and active" }
  }

  useEffect(() => {
    if (!running || !pushEnabled || !ntfyTopic.trim()) return
    const lotInfo    = state.currentLotNumber ? ` · Lot ${state.currentLotNumber}` : ""
    const auctionInfo = `Auction ${auctionId}`

    // repeatMs: if set, re-fires every repeatMs while condition stays true
    function checkRule(ruleId: string, active: boolean, onActive: () => Parameters<typeof sendNtfy>[0], repeatMs?: number) {
      if (!ruleEnabled[ruleId]) { ruleActiveRef.current[ruleId] = false; return }
      const wasActive = !!ruleActiveRef.current[ruleId]
      const lastFired = ruleLastFiredRef.current[ruleId] ?? 0
      const shouldFire = active && (!wasActive || (!!repeatMs && Date.now() - lastFired >= repeatMs))
      if (shouldFire) {
        sendNtfy(onActive()).catch(() => {})
        ruleLastFiredRef.current[ruleId] = Date.now()
      }
      ruleActiveRef.current[ruleId] = active
    }

    checkRule("connection_drop", connState === "closed" || connState === "error",
      () => ({ title: "Auction alert · Connection dropped", body: `WebSocket ${connState}${lotInfo}\n${auctionInfo}`, priority: 5, tags: ["rotating_light"] }))

    const stallRedSec = ruleThresholds["stall_red"] ?? 120
    const stallRedActive = connState === "open" && msSinceLastBid !== null && msSinceLastBid >= stallRedSec * 1000
    checkRule("stall_red", stallRedActive,
      () => ({ title: "Auction alert · No bids", body: `No bid activity for ${stallRedSec}+ seconds${lotInfo}\n${auctionInfo}`, priority: 5, tags: ["rotating_light"] }),
      stallRedSec * 1000)

    const stallAmberSec = ruleThresholds["stall_amber"] ?? 60
    checkRule("stall_amber", connState === "open" && msSinceLastBid !== null && msSinceLastBid >= stallAmberSec * 1000 && !stallRedActive,
      () => ({ title: "Auction warning · Quiet", body: `No bids in last ${stallAmberSec} seconds${lotInfo}\n${auctionInfo}`, priority: 4, tags: ["warning"] }),
      stallAmberSec * 1000)

    checkRule("paused", state.paused,
      () => ({ title: "Auction paused", body: `Auctioneer paused the sale${lotInfo}\n${auctionInfo}`, priority: 4, tags: ["pause_button"] }))
    checkRule("bid_quicker", state.bidQuicker,
      () => ({ title: "Auctioneer: bid quicker", body: `Auctioneer asking for faster bids${lotInfo}\n${auctionInfo}`, priority: 4, tags: ["zap"] }))
    checkRule("fair_warning", state.fairWarning,
      () => ({ title: "Fair warning called", body: `Auctioneer about to hammer${lotInfo}\n${auctionInfo}`, priority: 3, tags: ["hammer"] }))

    if (healthBand !== "green" && (healthBand === "amber" || healthBand === "red")) {
      ruleActiveRef.current["__bad_state__"] = true
    } else if (healthBand === "green") {
      if (ruleActiveRef.current["__bad_state__"] && ruleEnabled["recovery"]) {
        sendNtfy({ title: "Auction recovered", body: `Back to live & active${lotInfo}\n${auctionInfo}`, priority: 3, tags: ["white_check_mark"] }).catch(() => {})
      }
      ruleActiveRef.current["__bad_state__"] = false
    }

    if (ruleEnabled["high_value_sold"]) {
      const threshold = ruleThresholds["high_value_sold"] ?? 1000
      const recent = state.recentLots[0]
      if (recent && recent.hammerPrice != null && recent.hammerPrice >= threshold) {
        const key = `${recent.lotId}-${recent.hammerPrice}`
        if (lastHighValueLotRef.current !== key) {
          lastHighValueLotRef.current = key
          sendNtfy({ title: `High-value sold · £${recent.hammerPrice.toLocaleString()}`, body: `Lot ${recent.lotNumber ?? recent.lotId} hammered at £${recent.hammerPrice.toLocaleString()}\n${auctionInfo}`, priority: 3, tags: ["moneybag"] }).catch(() => {})
        }
      }
    }

    if (ruleEnabled["lot_passed"]) {
      const recent = state.recentLots[0]
      if (recent && /pass|unsold|withdrawn/i.test(recent.outcome ?? "")) {
        const key = `${recent.lotId}-${recent.outcome}`
        if (lastPassedLotRef.current !== key) {
          lastPassedLotRef.current = key
          sendNtfy({ title: `Lot ${recent.outcome ?? "passed"}`, body: `Lot ${recent.lotNumber ?? recent.lotId} — ${recent.outcome}\n${auctionInfo}`, priority: 2, tags: ["arrow_right"] }).catch(() => {})
        }
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [healthBand, healthLabel, connState, msSinceLastBid, state.paused, state.fairWarning, state.bidQuicker, state.recentLots.length, running, pushEnabled])

  useEffect(() => {
    if (!running || !pushEnabled || !ntfyTopic.trim()) return
    if (!ruleEnabled["heartbeat"]) return
    const minutes = ruleThresholds["heartbeat"] ?? 15
    const id = setInterval(() => {
      const lotInfo = state.currentLotNumber ? ` · Lot ${state.currentLotNumber}` : ""
      sendNtfy({ title: "Auction monitor heartbeat", body: `Still running · ${state.soldCount} sold so far${lotInfo}\nAuction ${auctionId}`, priority: 1, tags: ["green_heart"] }).catch(() => {})
    }, Math.max(1, minutes) * 60_000)
    return () => clearInterval(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running, pushEnabled, ruleEnabled["heartbeat"], ruleThresholds["heartbeat"]])

  // ════════════════════════════════════════════════════════════════════════════
  // TIMED AUCTION STATE
  // ════════════════════════════════════════════════════════════════════════════

  // Full URL stored so it re-populates the input on reload; ID is extracted from it.
  const [timedUrl, setTimedUrl] = useState<string>(() => {
    if (typeof window === "undefined") return ""
    return localStorage.getItem("auction_monitor_timed_url") ?? ""
  })
  const [timedId, setTimedId] = useState<string>(() => {
    if (typeof window === "undefined") return ""
    return localStorage.getItem("auction_monitor_timed_id") ?? ""
  })
  const [timedRunning, setTimedRunning]         = useState(false)
  const [timedConnState, setTimedConnState]     = useState<ConnState>("idle")
  const [timedLastMsgAt, setTimedLastMsgAt]     = useState<Date | null>(null)
  const [timedLog, setTimedLog]                 = useState<MsgEntry[]>([])
  const [timedReconnects, setTimedReconnects]   = useState(0)
  const [timedShowRaw, setTimedShowRaw]         = useState(true)
  // Discovery panel: list of every unique command type seen on this session
  const [timedCmdsSeen, setTimedCmdsSeen]       = useState<string[]>([])

  const timedWsRef             = useRef<WebSocket | null>(null)
  const timedReconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const timedShouldReconnect   = useRef(false)
  // Track session start so stall alerts fire even if zero messages ever arrive
  const timedSessionStartRef   = useRef<Date | null>(null)

  const [timedRuleEnabled, setTimedRuleEnabled] = useState<Record<string, boolean>>(() => {
    if (typeof window === "undefined") return Object.fromEntries(TIMED_ALERT_RULES.map(r => [r.id, r.defaultOn]))
    try {
      const raw = localStorage.getItem("auction_monitor_timed_rules_enabled")
      const parsed = raw ? JSON.parse(raw) : null
      const out: Record<string, boolean> = {}
      for (const r of TIMED_ALERT_RULES) out[r.id] = parsed?.[r.id] ?? r.defaultOn
      return out
    } catch { return Object.fromEntries(TIMED_ALERT_RULES.map(r => [r.id, r.defaultOn])) }
  })
  const [timedRuleThresholds, setTimedRuleThresholds] = useState<Record<string, number>>(() => {
    if (typeof window === "undefined") return Object.fromEntries(TIMED_ALERT_RULES.filter(r => r.threshold).map(r => [r.id, r.threshold!.default]))
    try {
      const raw = localStorage.getItem("auction_monitor_timed_rule_thresholds")
      const parsed = raw ? JSON.parse(raw) : null
      const out: Record<string, number> = {}
      for (const r of TIMED_ALERT_RULES) if (r.threshold) out[r.id] = parsed?.[r.id] ?? r.threshold.default
      return out
    } catch { return Object.fromEntries(TIMED_ALERT_RULES.filter(r => r.threshold).map(r => [r.id, r.threshold!.default])) }
  })
  const [timedShowRuleSettings, setTimedShowRuleSettings] = useState(false)
  const timedRuleActiveRef    = useRef<Record<string, boolean>>({})
  const timedRuleLastFiredRef = useRef<Record<string, number>>({})

  function setTimedRuleEnabledPersisted(id: string, enabled: boolean) {
    setTimedRuleEnabled(prev => {
      const next = { ...prev, [id]: enabled }
      try { localStorage.setItem("auction_monitor_timed_rules_enabled", JSON.stringify(next)) } catch {}
      return next
    })
  }
  function setTimedRuleThresholdPersisted(id: string, value: number) {
    setTimedRuleThresholds(prev => {
      const next = { ...prev, [id]: value }
      try { localStorage.setItem("auction_monitor_timed_rule_thresholds", JSON.stringify(next)) } catch {}
      return next
    })
  }

  // Extract the numeric ID from the end of a Vectis bidding URL, e.g.
  //   https://www.vectis.co.uk/bidding/F067-specialist-diecast-tinplate-timed-1399  →  "1399"
  function extractTimedId(url: string): string {
    const match = /(\d+)\s*$/.exec(url.trim().replace(/\/+$/, ""))
    return match?.[1] ?? ""
  }

  useEffect(() => {
    if (!timedRunning) {
      timedShouldReconnect.current = false
      if (timedWsRef.current) { try { timedWsRef.current.close() } catch {}; timedWsRef.current = null }
      if (timedReconnectTimerRef.current) { clearTimeout(timedReconnectTimerRef.current); timedReconnectTimerRef.current = null }
      setTimedConnState("idle")
      return
    }
    timedShouldReconnect.current = true
    const url = WS_TEMPLATE.replace("{id}", timedId.trim())

    function openTimedSocket() {
      if (!timedShouldReconnect.current) return
      setTimedConnState("connecting")
      try {
        const ws = new WebSocket(url)
        timedWsRef.current = ws
        ws.onopen = () => setTimedConnState("open")
        ws.onmessage = (ev) => {
          const raw = typeof ev.data === "string" ? ev.data : "[binary]"
          let parsed: any = null
          try { parsed = JSON.parse(raw) } catch {}
          const at = new Date()
          setTimedLastMsgAt(at)
          setTimedLog(prev => {
            const next = [{ at, raw, parsed }, ...prev]
            return next.length > MAX_LOG_ROWS ? next.slice(0, MAX_LOG_ROWS) : next
          })
          // Track unique command types for the discovery panel
          if (typeof parsed?.command === "string") {
            setTimedCmdsSeen(prev =>
              prev.includes(parsed.command) ? prev : [...prev, parsed.command]
            )
          }
        }
        ws.onerror = () => setTimedConnState("error")
        ws.onclose = () => {
          timedWsRef.current = null
          setTimedConnState("closed")
          if (timedShouldReconnect.current) {
            setTimedReconnects(r => r + 1)
            timedReconnectTimerRef.current = setTimeout(openTimedSocket, RECONNECT_DELAY_MS)
          }
        }
      } catch {
        setTimedConnState("error")
        if (timedShouldReconnect.current) timedReconnectTimerRef.current = setTimeout(openTimedSocket, RECONNECT_DELAY_MS)
      }
    }
    openTimedSocket()
    return () => {
      timedShouldReconnect.current = false
      if (timedWsRef.current) { try { timedWsRef.current.close() } catch {}; timedWsRef.current = null }
      if (timedReconnectTimerRef.current) clearTimeout(timedReconnectTimerRef.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timedRunning, timedId])

  function timedStart() {
    if (!timedId.trim()) return
    localStorage.setItem("auction_monitor_timed_id",  timedId.trim())
    localStorage.setItem("auction_monitor_timed_url", timedUrl.trim())
    setTimedLog([]); setTimedLastMsgAt(null); setTimedReconnects(0); setTimedCmdsSeen([])
    timedRuleActiveRef.current = {}
    timedRuleLastFiredRef.current = {}
    timedSessionStartRef.current = new Date()
    setTimedRunning(true)
  }
  function timedStop() { setTimedRunning(false) }

  const timedMsSinceLast = timedLastMsgAt ? now.getTime() - timedLastMsgAt.getTime() : null
  // Same fallback used in the alert effect — measures from session start if no message yet
  const timedMsSinceActivity = timedMsSinceLast !== null
    ? timedMsSinceLast
    : timedSessionStartRef.current ? now.getTime() - timedSessionStartRef.current.getTime() : null

  // Countdown helpers for timed alert rules
  function timedRuleCountdownMs(ruleId: string): number | null {
    if (!timedRunning || timedConnState !== "open") return null
    if (ruleId === "stall_red")   return timedMsSinceActivity !== null ? (timedRuleThresholds["stall_red"]   ?? 120) * 1000 - timedMsSinceActivity : null
    if (ruleId === "stall_amber") return timedMsSinceActivity !== null ? (timedRuleThresholds["stall_amber"] ??  60) * 1000 - timedMsSinceActivity : null
    return null
  }

  let timedHealthBand: "green" | "amber" | "red" | "grey" = "grey"
  let timedHealthLabel = "Not started"
  if (timedRunning) {
    if (timedConnState !== "open")              { timedHealthBand = "red";   timedHealthLabel = `Connection ${timedConnState}` }
    else if (timedMsSinceLast === null)          { timedHealthBand = "amber"; timedHealthLabel = "Connected — waiting for first message" }
    else if (timedMsSinceLast > STALE_RED_MS)   { timedHealthBand = "red";   timedHealthLabel = "No messages for over 2 minutes — feed may have dropped" }
    else if (timedMsSinceLast > STALE_AMBER_MS) { timedHealthBand = "amber"; timedHealthLabel = "No messages for 30+ seconds — keep an eye on it" }
    else                                         { timedHealthBand = "green"; timedHealthLabel = "Live and active" }
  }

  useEffect(() => {
    if (!timedRunning || !pushEnabled || !ntfyTopic.trim()) return
    const auctionInfo = `Timed auction ${timedId}`

    // repeatMs: if set, re-fires every repeatMs while condition stays true
    function checkRule(ruleId: string, active: boolean, onActive: () => Parameters<typeof sendNtfy>[0], repeatMs?: number) {
      if (!timedRuleEnabled[ruleId]) { timedRuleActiveRef.current[ruleId] = false; return }
      const wasActive = !!timedRuleActiveRef.current[ruleId]
      const lastFired = timedRuleLastFiredRef.current[ruleId] ?? 0
      const shouldFire = active && (!wasActive || (!!repeatMs && Date.now() - lastFired >= repeatMs))
      if (shouldFire) {
        sendNtfy(onActive()).catch(() => {})
        timedRuleLastFiredRef.current[ruleId] = Date.now()
      }
      timedRuleActiveRef.current[ruleId] = active
    }

    checkRule("connection_drop", timedConnState === "closed" || timedConnState === "error",
      () => ({ title: "Timed auction · Connection dropped", body: `WebSocket ${timedConnState}\n${auctionInfo}`, priority: 5, tags: ["rotating_light"] }))

    // Fall back to time-since-session-start if no message has ever arrived,
    // so stall alerts fire even on a completely silent connection.
    const msSinceActivity = timedMsSinceLast !== null
      ? timedMsSinceLast
      : timedSessionStartRef.current ? now.getTime() - timedSessionStartRef.current.getTime() : null

    const stallRedSec = timedRuleThresholds["stall_red"] ?? 120
    const tStallRed = timedConnState === "open" && msSinceActivity !== null && msSinceActivity >= stallRedSec * 1000
    checkRule("stall_red", tStallRed,
      () => ({ title: "Timed auction · No activity", body: `No messages for ${stallRedSec}+ seconds\n${auctionInfo}`, priority: 5, tags: ["rotating_light"] }),
      stallRedSec * 1000)

    const stallAmberSec = timedRuleThresholds["stall_amber"] ?? 60
    checkRule("stall_amber", timedConnState === "open" && msSinceActivity !== null && msSinceActivity >= stallAmberSec * 1000 && !tStallRed,
      () => ({ title: "Timed auction · Quiet", body: `No messages in last ${stallAmberSec} seconds\n${auctionInfo}`, priority: 4, tags: ["warning"] }),
      stallAmberSec * 1000)

    if (timedHealthBand !== "green" && (timedHealthBand === "amber" || timedHealthBand === "red")) {
      timedRuleActiveRef.current["__bad_state__"] = true
    } else if (timedHealthBand === "green") {
      if (timedRuleActiveRef.current["__bad_state__"] && timedRuleEnabled["recovery"]) {
        sendNtfy({ title: "Timed auction recovered", body: `Back to active\n${auctionInfo}`, priority: 3, tags: ["white_check_mark"] }).catch(() => {})
      }
      timedRuleActiveRef.current["__bad_state__"] = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timedHealthBand, timedConnState, timedMsSinceLast, timedRunning, pushEnabled, now])

  useEffect(() => {
    if (!timedRunning || !pushEnabled || !ntfyTopic.trim()) return
    if (!timedRuleEnabled["heartbeat"]) return
    const minutes = timedRuleThresholds["heartbeat"] ?? 15
    const id = setInterval(() => {
      sendNtfy({ title: "Timed auction heartbeat", body: `Still running · Timed auction ${timedId}`, priority: 1, tags: ["green_heart"] }).catch(() => {})
    }, Math.max(1, minutes) * 60_000)
    return () => clearInterval(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timedRunning, pushEnabled, timedRuleEnabled["heartbeat"], timedRuleThresholds["heartbeat"]])

  // ════════════════════════════════════════════════════════════════════════════
  // RENDER
  // ════════════════════════════════════════════════════════════════════════════

  const bandStyle: Record<"green" | "amber" | "red" | "grey", string> = {
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
          Watches a Vectis auction WebSocket feed for stalls, dropped connections and silent gaps.
        </p>
      </div>

      {/* Tab bar */}
      <div className="flex gap-1 mb-6 bg-gray-100 rounded-xl p-1 w-fit">
        <button
          onClick={() => setActiveTab("live")}
          className={`px-5 py-2 rounded-lg text-sm font-medium transition-colors ${activeTab === "live" ? "bg-white text-gray-900 shadow-sm" : "text-gray-500 hover:text-gray-700"}`}
        >
          🔴 Live Auction
        </button>
        <button
          onClick={() => setActiveTab("timed")}
          className={`px-5 py-2 rounded-lg text-sm font-medium transition-colors ${activeTab === "timed" ? "bg-white text-gray-900 shadow-sm" : "text-gray-500 hover:text-gray-700"}`}
        >
          ⏱ Timed Auction
        </button>
      </div>

      {/* Phone notifications — shared between both tabs */}
      <div className="bg-white rounded-xl border border-gray-200 p-4 mb-6">
        <div className="flex items-start justify-between gap-3 mb-3 flex-wrap">
          <div>
            <h3 className="text-sm font-semibold text-gray-700">📱 Phone notifications</h3>
            <p className="text-[11px] text-gray-500 mt-0.5">
              Shared across both tabs. Install the free <a href="https://ntfy.sh" target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">ntfy</a> app, subscribe to your topic, and alerts arrive instantly.
            </p>
          </div>
          <label className="text-xs text-gray-600 flex items-center gap-1.5 cursor-pointer select-none">
            <input
              type="checkbox" checked={pushEnabled}
              onChange={e => { setPushEnabled(e.target.checked); localStorage.setItem("auction_monitor_push_enabled", e.target.checked ? "1" : "0") }}
              className="w-4 h-4 accent-emerald-600"
            />
            Enable
          </label>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex-1 min-w-[200px]">
            <label className="block text-[11px] text-gray-500 mb-1">ntfy topic</label>
            <input
              type="text" value={ntfyTopic}
              onChange={e => { setNtfyTopic(e.target.value); localStorage.setItem("auction_monitor_ntfy_topic", e.target.value) }}
              placeholder="e.g. vectis-auction-alerts_JJ"
              className="w-full rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-emerald-500"
            />
          </div>
          <button onClick={sendTestNotification} disabled={!ntfyTopic.trim()} className="self-end bg-emerald-600 hover:bg-emerald-700 disabled:opacity-40 text-white text-xs font-semibold px-3 py-1.5 rounded-lg">Send test</button>
          {pushStatus && <span className="self-end text-xs text-gray-600">{pushStatus}</span>}
        </div>
      </div>

      {/* ══════════════════════ LIVE TAB ══════════════════════ */}
      {activeTab === "live" && (
        <>
          {/* Controls */}
          <div className="bg-white rounded-xl border border-gray-200 p-4 mb-6 flex items-end gap-3 flex-wrap">
            <div className="flex-1 min-w-[200px]">
              <label className="block text-xs font-medium text-gray-600 mb-1">Auction ID</label>
              <input
                type="text" value={auctionId}
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
              <button onClick={start} disabled={!auctionId.trim()} className="bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-sm font-semibold px-5 py-2 rounded-lg">▶ Start monitoring</button>
            ) : (
              <button onClick={stop} className="bg-red-600 hover:bg-red-700 text-white text-sm font-semibold px-5 py-2 rounded-lg">■ Stop</button>
            )}
          </div>

          {/* Alert rules */}
          <div className="bg-white rounded-xl border border-gray-200 p-4 mb-6">
            <button onClick={() => setShowRuleSettings(s => !s)} className="text-xs text-blue-600 hover:text-blue-800 font-medium">
              {showRuleSettings ? "▼ Hide alert rules" : "▶ Configure alert rules"}
              <span className="ml-2 text-gray-500 font-normal">({Object.values(ruleEnabled).filter(Boolean).length} of {ALERT_RULES.length} enabled)</span>
            </button>
            {showRuleSettings && (
              <ul className="mt-3 space-y-2">
                {ALERT_RULES.map(rule => {
                  const enabled   = !!ruleEnabled[rule.id]
                  const threshold = ruleThresholds[rule.id]
                  return (
                    <li key={rule.id} className={`flex items-start gap-3 p-2.5 rounded-lg border ${enabled ? "border-emerald-200 bg-emerald-50/40" : "border-gray-200 bg-gray-50/40"}`}>
                      <input type="checkbox" checked={enabled} onChange={e => setRuleEnabledPersisted(rule.id, e.target.checked)} className="mt-1 w-4 h-4 accent-emerald-600 flex-shrink-0" />
                      <div className="flex-1">
                        <p className="text-sm font-medium text-gray-800">{rule.label}</p>
                        <p className="text-[11px] text-gray-500 mt-0.5">{rule.description}</p>
                      </div>
                      {rule.threshold && (
                        <div className="flex items-center gap-2 self-center">
                          <RuleCountdown msRemaining={liveRuleCountdownMs(rule.id)} />
                          <span className="text-[11px] text-gray-500">{rule.threshold.label}</span>
                          <input
                            type="number" value={threshold ?? rule.threshold.default}
                            min={rule.threshold.min} max={rule.threshold.max}
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

          {/* Status header */}
          <div className="bg-white rounded-xl border border-gray-200 p-5 mb-6">
            <div className="flex items-center gap-3 mb-4">
              <span className={`inline-block w-3 h-3 rounded-full ${bandStyle[healthBand]} ${running && healthBand !== "red" ? "animate-pulse" : ""}`} />
              <h2 className="text-lg font-bold text-gray-900">{healthLabel}</h2>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 text-sm">
              <Stat label="Connection"        value={connState} />
              <Stat label="Last message"      value={msSinceLast === null ? "—" : formatAgo(msSinceLast)} />
              <Stat label="Messages received" value={log.length.toLocaleString()} />
              <Stat label="Reconnects"        value={reconnects.toLocaleString()} />
            </div>

            {(state.saleStateAt || state.lotLockAt) && (
              <div className="mt-4 flex flex-wrap items-center gap-2">
                {state.paused     && <span className="bg-amber-100 border border-amber-300 text-amber-900 text-xs font-semibold px-2.5 py-1 rounded">⏸ PAUSED</span>}
                {state.fairWarning && <span className="bg-red-100 border border-red-300 text-red-900 text-xs font-semibold px-2.5 py-1 rounded animate-pulse">🔨 FAIR WARNING</span>}
                {state.bidQuicker  && <span className="bg-orange-100 border border-orange-300 text-orange-900 text-xs font-semibold px-2.5 py-1 rounded">⚡ BID QUICKER</span>}
                {state.saleMessage && <span className="bg-blue-100 border border-blue-300 text-blue-900 text-xs font-semibold px-2.5 py-1 rounded">💬 MESSAGE</span>}
                {!state.paused && !state.fairWarning && !state.bidQuicker && !state.saleMessage && <span className="text-xs text-gray-500">Sale state: normal</span>}
                {state.lotLockStatus !== null && state.lotLockStatus !== 0 && <span className="bg-purple-100 border border-purple-300 text-purple-900 text-xs font-semibold px-2.5 py-1 rounded">🔒 Lot lock {state.lotLockStatus}</span>}
              </div>
            )}

            {state.currentLotId !== null && (
              <div className="mt-4 pt-4 border-t border-gray-100">
                <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 text-sm">
                  <Stat label="Current lot"     value={state.currentLotNumber ? `Lot ${state.currentLotNumber}` : `#${state.currentLotId}`} />
                  <Stat label="Current bid"     value={state.currentBid  != null ? `£${state.currentBid.toLocaleString()}`  : "—"} />
                  <Stat label="Asking bid"      value={state.askingBid   != null ? `£${state.askingBid.toLocaleString()}`   : "—"} />
                  <Stat label="Winning paddle"  value={state.winner === 0 ? "Saleroom" : state.winner != null ? String(state.winner) : "—"} />
                  <Stat label="Platform"        value={state.platform ?? "—"} />
                </div>
                <div className="mt-3 grid grid-cols-2 sm:grid-cols-5 gap-3 text-sm">
                  <Stat label="Last bid"              value={state.lastBidAt ? formatAgo(now.getTime() - state.lastBidAt.getTime()) : "—"} />
                  <Stat label="Bids on this lot"       value={state.bidsThisLot.toLocaleString()} />
                  <Stat label="Lots sold this session" value={state.soldCount.toLocaleString()} />
                  <Stat label="Lots passed"            value={state.passedCount.toLocaleString()} />
                  <Stat label="Session hammer"         value={`£${state.sessionHammer.toLocaleString()}`} />
                </div>
                <div className="mt-3 grid grid-cols-1 sm:grid-cols-3 gap-3 text-sm">
                  <Stat
                    label="Bids by platform"
                    value={Object.keys(state.platformCounts).length === 0 ? "—" : Object.entries(state.platformCounts).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}:${v}`).join(", ")}
                  />
                </div>
              </div>
            )}
          </div>

          {/* Recent lots */}
          {state.recentLots.length > 0 && (
            <div className="bg-white rounded-xl border border-gray-200 overflow-hidden mb-6">
              <div className="px-4 py-3 border-b border-gray-100">
                <h3 className="text-sm font-semibold text-gray-700">Recent lots ({state.recentLots.length})</h3>
                <p className="text-[11px] text-gray-500 mt-0.5">Newest first · {state.soldCount} sold · {state.passedCount} passed · £{state.sessionHammer.toLocaleString()} total hammer</p>
              </div>
              <ul className="divide-y divide-gray-100">
                {state.recentLots.map((lot, i) => {
                  const isSold   = /sold/i.test(lot.outcome ?? "")
                  const isPassed = /pass|unsold|withdrawn/i.test(lot.outcome ?? "")
                  const badgeClass = isSold ? "bg-emerald-100 text-emerald-800 border-emerald-300" : isPassed ? "bg-gray-100 text-gray-700 border-gray-300" : "bg-blue-100 text-blue-700 border-blue-300"
                  return (
                    <li key={i} className="px-4 py-2.5 flex items-center gap-3 text-sm">
                      <span className="font-mono font-semibold text-gray-700 min-w-[60px]">{lot.lotNumber ? `Lot ${lot.lotNumber}` : `#${lot.lotId}`}</span>
                      <span className={`text-[11px] font-semibold border px-2 py-0.5 rounded uppercase tracking-wide ${badgeClass}`}>{lot.outcome ?? "?"}</span>
                      <span className="flex-1" />
                      <span className="text-gray-600 font-mono">{lot.hammerPrice != null ? `£${lot.hammerPrice.toLocaleString()}` : "—"}</span>
                      <span className="text-[11px] text-gray-400 min-w-[60px] text-right">{lot.at.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}</span>
                    </li>
                  )
                })}
              </ul>
            </div>
          )}

          {/* Message log */}
          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-gray-700">Message log ({log.length})</h3>
              <div className="flex items-center gap-3">
                <label className="text-xs text-gray-500 flex items-center gap-1.5 cursor-pointer">
                  <input type="checkbox" checked={showRaw} onChange={e => setShowRaw(e.target.checked)} />
                  Show raw payload
                </label>
                <CopyAllButton log={log} />
                <button onClick={() => setLog([])} className="text-xs text-gray-500 hover:text-red-600">Clear</button>
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
                      <span className="text-gray-700 font-medium">{m.parsed ? describeMessage(m.parsed) : "(non-JSON)"}</span>
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
        </>
      )}

      {/* ══════════════════════ TIMED TAB ══════════════════════ */}
      {activeTab === "timed" && (
        <>
          {/* Controls */}
          <div className="bg-white rounded-xl border border-gray-200 p-4 mb-6">
            <div className="mb-4">
              <label className="block text-xs font-medium text-gray-600 mb-1">Auction URL</label>
              <input
                type="text"
                value={timedUrl}
                onChange={e => {
                  const url = e.target.value
                  setTimedUrl(url)
                  const id = extractTimedId(url)
                  if (id) setTimedId(id)
                }}
                onKeyDown={e => { if (e.key === "Enter" && !timedRunning && timedId.trim()) timedStart() }}
                placeholder="https://www.vectis.co.uk/bidding/F067-...-timed-1399"
                disabled={timedRunning}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-50"
              />
              <p className="text-[11px] text-gray-500 mt-1">
                Paste the full bidding page URL — the ID is extracted automatically from the end of the slug.
              </p>
            </div>
            <div className="flex items-end gap-3 flex-wrap">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Extracted ID</label>
                <input
                  type="text" value={timedId}
                  onChange={e => setTimedId(e.target.value)}
                  onKeyDown={e => { if (e.key === "Enter" && !timedRunning && timedId.trim()) timedStart() }}
                  placeholder="e.g. 1399"
                  disabled={timedRunning}
                  className="w-32 rounded-lg border border-gray-300 px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-50"
                />
                <p className="text-[11px] text-gray-400 mt-1 font-mono">
                  wss://…/wss/<span className="font-bold text-gray-600">{timedId || "?"}</span>
                </p>
              </div>
              {!timedRunning ? (
                <button onClick={timedStart} disabled={!timedId.trim()} className="bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-sm font-semibold px-5 py-2 rounded-lg">▶ Start monitoring</button>
              ) : (
                <button onClick={timedStop} className="bg-red-600 hover:bg-red-700 text-white text-sm font-semibold px-5 py-2 rounded-lg">■ Stop</button>
              )}
            </div>
          </div>

          {/* Status header */}
          <div className="bg-white rounded-xl border border-gray-200 p-5 mb-6">
            <div className="flex items-center gap-3 mb-4">
              <span className={`inline-block w-3 h-3 rounded-full ${bandStyle[timedHealthBand]} ${timedRunning && timedHealthBand !== "red" ? "animate-pulse" : ""}`} />
              <h2 className="text-lg font-bold text-gray-900">{timedHealthLabel}</h2>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 text-sm">
              <Stat label="Connection"        value={timedConnState} />
              <Stat label="Last message"      value={timedMsSinceLast === null ? "—" : formatAgo(timedMsSinceLast)} />
              <Stat label="Messages received" value={timedLog.length.toLocaleString()} />
              <Stat label="Reconnects"        value={timedReconnects.toLocaleString()} />
            </div>
          </div>

          {/* Discovery panel — appears once messages start coming in */}
          {timedCmdsSeen.length > 0 && (
            <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 mb-6">
              <h3 className="text-sm font-semibold text-blue-800 mb-1">🔍 Event types seen on this connection</h3>
              <p className="text-[11px] text-blue-600 mb-3">
                These are all the WebSocket command types received so far. Share these with the dev team to build proper timed-auction parsing.
              </p>
              <div className="flex flex-wrap gap-2">
                {timedCmdsSeen.map(cmd => (
                  <span key={cmd} className="bg-white border border-blue-300 text-blue-900 text-xs font-mono px-2.5 py-1 rounded">
                    {cmd}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Alert rules */}
          <div className="bg-white rounded-xl border border-gray-200 p-4 mb-6">
            <button onClick={() => setTimedShowRuleSettings(s => !s)} className="text-xs text-blue-600 hover:text-blue-800 font-medium">
              {timedShowRuleSettings ? "▼ Hide alert rules" : "▶ Configure alert rules"}
              <span className="ml-2 text-gray-500 font-normal">({Object.values(timedRuleEnabled).filter(Boolean).length} of {TIMED_ALERT_RULES.length} enabled)</span>
            </button>
            {timedShowRuleSettings && (
              <ul className="mt-3 space-y-2">
                {TIMED_ALERT_RULES.map(rule => {
                  const enabled   = !!timedRuleEnabled[rule.id]
                  const threshold = timedRuleThresholds[rule.id]
                  return (
                    <li key={rule.id} className={`flex items-start gap-3 p-2.5 rounded-lg border ${enabled ? "border-emerald-200 bg-emerald-50/40" : "border-gray-200 bg-gray-50/40"}`}>
                      <input type="checkbox" checked={enabled} onChange={e => setTimedRuleEnabledPersisted(rule.id, e.target.checked)} className="mt-1 w-4 h-4 accent-emerald-600 flex-shrink-0" />
                      <div className="flex-1">
                        <p className="text-sm font-medium text-gray-800">{rule.label}</p>
                        <p className="text-[11px] text-gray-500 mt-0.5">{rule.description}</p>
                      </div>
                      {rule.threshold && (
                        <div className="flex items-center gap-2 self-center">
                          <RuleCountdown msRemaining={timedRuleCountdownMs(rule.id)} />
                          <span className="text-[11px] text-gray-500">{rule.threshold.label}</span>
                          <input
                            type="number" value={threshold ?? rule.threshold.default}
                            min={rule.threshold.min} max={rule.threshold.max}
                            onChange={e => setTimedRuleThresholdPersisted(rule.id, Math.max(rule.threshold!.min, Math.min(rule.threshold!.max, Number(e.target.value) || rule.threshold!.default)))}
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

          {/* Message log */}
          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-gray-700">Message log ({timedLog.length})</h3>
              <div className="flex items-center gap-3">
                <label className="text-xs text-gray-500 flex items-center gap-1.5 cursor-pointer">
                  <input type="checkbox" checked={timedShowRaw} onChange={e => setTimedShowRaw(e.target.checked)} />
                  Show raw payload
                </label>
                <CopyAllButton log={timedLog} />
                <button onClick={() => setTimedLog([])} className="text-xs text-gray-500 hover:text-red-600">Clear</button>
              </div>
            </div>
            {timedLog.length === 0 ? (
              <p className="px-4 py-8 text-center text-sm text-gray-400">
                {timedRunning ? "Waiting for messages from the auction…" : "Click Start to begin monitoring."}
              </p>
            ) : (
              <ul className="divide-y divide-gray-100 max-h-[60vh] overflow-y-auto">
                {timedLog.map((m, i) => (
                  <li key={i} className="px-4 py-2 text-xs hover:bg-gray-50">
                    <div className="flex items-baseline gap-3 mb-0.5">
                      <span className="text-gray-400 font-mono shrink-0">{m.at.toLocaleTimeString("en-GB")}</span>
                      <span className="text-gray-700 font-medium">{m.parsed ? describeMessage(m.parsed) : "(non-JSON)"}</span>
                    </div>
                    {timedShowRaw && (
                      <pre className="bg-gray-50 border border-gray-100 rounded px-2 py-1 mt-1 font-mono text-[11px] text-gray-600 overflow-x-auto whitespace-pre-wrap break-all">
                        {m.parsed ? JSON.stringify(m.parsed, null, 2) : m.raw}
                      </pre>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      )}
    </div>
  )
}

// ── Shared helper components ──────────────────────────────────────────────────

function CopyAllButton({ log }: { log: MsgEntry[] }) {
  const [copied, setCopied] = useState(false)
  async function copy() {
    if (log.length === 0) return
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
      alert("Couldn't copy automatically — your browser may have blocked clipboard access.")
    }
  }
  return (
    <button onClick={copy} disabled={log.length === 0}
      className="text-xs text-blue-600 hover:text-blue-800 disabled:opacity-40 disabled:cursor-not-allowed"
      title={`Copy all ${log.length} message${log.length === 1 ? "" : "s"} to clipboard`}
    >
      {copied ? "✓ Copied" : `📋 Copy all (${log.length})`}
    </button>
  )
}

// Countdown badge shown next to stall alert rules.
// msRemaining: null = not running / no data, <=0 = currently firing, >0 = time left
function RuleCountdown({ msRemaining }: { msRemaining: number | null }) {
  if (msRemaining === null) return null
  if (msRemaining <= 0) {
    return (
      <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-red-600 animate-pulse min-w-[56px]">
        ● Active
      </span>
    )
  }
  const totalSecs = Math.ceil(msRemaining / 1000)
  const m = Math.floor(totalSecs / 60)
  const s = totalSecs % 60
  const display = m > 0 ? `${m}m ${s}s` : `${s}s`
  const colour = totalSecs <= 15 ? "text-red-500" : totalSecs <= 45 ? "text-amber-500" : "text-gray-400"
  return (
    <span className={`text-[11px] font-mono min-w-[56px] text-right ${colour}`}>
      {display}
    </span>
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

function describeMessage(obj: any): string {
  if (!obj || typeof obj !== "object") return String(obj)
  const cmd = typeof obj.command === "string" ? obj.command : null
  const c   = obj.content ?? {}

  if (cmd === "liveBidEvent") {
    const lot = c.lot_id, amt = c.amount, ask = c.asking, plat = c.platform
    return `Bid · lot ${lot} · £${amt} (asking £${ask})${plat ? ` · ${plat}` : ""}`
  }
  if (cmd === "sensorNetworkEvent")    return `Sensor · ${c.sensor_name ?? "?"} = ${c.sensor_value}`
  if (cmd === "getFairWarningStatus") {
    const flags: string[] = []
    if (c.paused)       flags.push("PAUSED")
    if (c.fair_warning) flags.push("FAIR WARNING")
    if (c.bid_quicker)  flags.push("BID QUICKER")
    if (c.message)      flags.push("MESSAGE")
    return `Sale state · ${flags.length ? flags.join(" + ") : "normal"}`
  }
  if (cmd === "activeLotLock")         return `Lot lock · status ${c.status}`
  if (cmd === "activeLotChange") {
    const newLot = c.lot_number ? `Lot ${c.lot_number}` : `#${c.lot_id}`
    return `Lot advance → ${newLot}${c.previous_lot_type ? ` (previous: ${c.previous_lot_type})` : ""}`
  }
  if (cmd === "lotInformationUpdate")  return `Lot info · ${c.lot_id} · ${c.key_name}=${c.key_value}${c.hammer_price ? ` · hammer £${c.hammer_price}` : ""}`
  if (cmd === "liveCommissionBidEvent") return `Commission bid · lot ${c.lot_id} · max £${c.amount} (executed £${c.executed_amount}) · paddle ${c.user_id}`
  if (cmd === "undoLiveBid")           return `Bid UNDONE · lot ${c.lot_id} · was £${c.amount}`
  if (cmd === "undoneBidChange")       return `Bid-change undo · lot ${c.bid_lot_id} · paddle ${c.bid_user_id}`
  if (cmd === "liveActiveReload")      return `Server reload signal`
  if (cmd) return cmd
  const keys = Object.keys(obj).slice(0, 5).join(", ")
  return `{${keys}${Object.keys(obj).length > 5 ? ", …" : ""}}`
}

// ── Live auction state extraction ─────────────────────────────────────────────

export type LotResult = {
  lotId:       number | string
  lotNumber:   string | null
  outcome:     string | null
  hammerPrice: number | null
  at:          Date
}

function extractAuctionState(log: MsgEntry[], persistentOutcomes: LotResult[]) {
  let currentLotId:     number | string | null = null
  let currentLotNumber: string | null          = null
  let currentBid:       number | null          = null
  let askingBid:        number | null          = null
  let winner:           number | string | null = null
  let platform:         string | null          = null
  let lastBidAt:        Date | null             = null
  let bidsThisLot:      number                  = 0
  const lotsSet = new Set<string>()

  let paused = false, fairWarning = false, bidQuicker = false, saleMessage = false
  let saleStateAt: Date | null = null
  let lotLockStatus: number | null = null
  let lotLockAt:     Date | null   = null
  const platformCounts: Record<string, number> = {}
  const lotNumberByLotId: Record<string, string> = {}
  const hammerByLotId:    Record<string, number>  = {}
  const lotOutcomes:      LotResult[]             = []

  const undoneBidLots = new Set<string>()
  for (const m of log) {
    if (m.parsed?.command !== "undoLiveBid") continue
    const lid = m.parsed.content?.lot_id
    if (lid != null) undoneBidLots.add(String(lid) + "-" + (m.parsed.content?.amount ?? "?"))
  }

  for (const m of log) {
    if (m.parsed?.command !== "liveBidEvent") continue
    const c = m.parsed.content ?? {}
    if (undoneBidLots.has(String(c.lot_id) + "-" + c.amount)) continue
    currentLotId = c.lot_id ?? null
    currentBid   = typeof c.amount  === "number" ? c.amount  : null
    askingBid    = typeof c.asking  === "number" ? c.asking  : null
    winner       = c.winner ?? null
    platform     = typeof c.platform === "string" ? c.platform : null
    lastBidAt    = m.at
    break
  }

  for (const m of log) {
    if (m.parsed?.command !== "getFairWarningStatus") continue
    const c = m.parsed.content ?? {}
    paused = !!c.paused; fairWarning = !!c.fair_warning; bidQuicker = !!c.bid_quicker; saleMessage = !!c.message; saleStateAt = m.at
    break
  }

  for (const m of log) {
    if (m.parsed?.command !== "activeLotLock") continue
    const c = m.parsed.content ?? {}
    lotLockStatus = typeof c.status === "number" ? c.status : null; lotLockAt = m.at
    break
  }

  const logOldestFirst = [...log].reverse()
  for (const m of logOldestFirst) {
    const cmd = m.parsed?.command
    const c   = m.parsed?.content ?? {}
    if (cmd === "liveBidEvent") {
      if (undoneBidLots.has(String(c.lot_id) + "-" + c.amount)) continue
      const lot = c.lot_id, plat = c.platform
      if (lot != null) lotsSet.add(String(lot))
      if (typeof plat === "string" && plat) platformCounts[plat] = (platformCounts[plat] ?? 0) + 1
    }
    if (cmd === "activeLotChange") {
      if (c.update_previous_lot && c.lot_id != null && c.previous_lot_type) {
        const prevLot = prevLotIdAtTimeOf(logOldestFirst, m)
        if (prevLot != null) {
          lotOutcomes.push({ lotId: prevLot, lotNumber: lotNumberByLotId[String(prevLot)] ?? null, outcome: String(c.previous_lot_type), hammerPrice: hammerByLotId[String(prevLot)] ?? null, at: m.at })
        }
      }
      if (c.lot_id != null && c.lot_number) lotNumberByLotId[String(c.lot_id)] = String(c.lot_number)
    }
    if (cmd === "lotInformationUpdate") {
      if (c.lot_id != null && c.hammer_price != null) {
        const hp = parseFloat(String(c.hammer_price))
        if (!isNaN(hp)) {
          hammerByLotId[String(c.lot_id)] = hp
          for (const o of lotOutcomes) {
            if (String(o.lotId) === String(c.lot_id) && o.hammerPrice == null) o.hammerPrice = hp
          }
        }
      }
    }
  }

  if (currentLotId != null) currentLotNumber = lotNumberByLotId[String(currentLotId)] ?? null

  for (const m of log) {
    if (m.parsed?.command !== "liveBidEvent") continue
    const c = m.parsed.content
    if (undoneBidLots.has(String(c?.lot_id) + "-" + c?.amount)) continue
    if (c?.lot_id != null && currentLotId != null && String(c.lot_id) === String(currentLotId)) bidsThisLot++
  }

  const soldCount    = persistentOutcomes.filter(o => /sold/i.test(o.outcome ?? "")).length
  const passedCount  = persistentOutcomes.filter(o => /pass|unsold|withdrawn/i.test(o.outcome ?? "")).length
  const sessionHammer = persistentOutcomes.reduce((s, o) => s + (o.hammerPrice ?? 0), 0)
  const recentLots   = [...persistentOutcomes].reverse().slice(0, 10)

  return { currentLotId, currentLotNumber, currentBid, askingBid, winner, platform, lastBidAt, bidsThisLot, lotsSeen: lotsSet.size, paused, fairWarning, bidQuicker, saleMessage, saleStateAt, lotLockStatus, lotLockAt, platformCounts, recentLots, soldCount, passedCount, sessionHammer }
}

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
