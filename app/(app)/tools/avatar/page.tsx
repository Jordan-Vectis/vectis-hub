"use client"

import { useRef, useState, useCallback, useEffect } from "react"

type Status = "idle" | "connecting" | "connected" | "speaking" | "error"

type Presenter = {
  presenter_id:  string
  id?:           string
  name:          string
  thumbnail_url: string
  image_url?:    string
}

type LotReading = {
  lotNumber:  string | null
  currentBid: string | null
  askingBid:  string | null
}

// ── Live Feed ─────────────────────────────────────────────────────────────────

type FeedEventConfig = { enabled: boolean; template: string }

const FEED_EVENTS = [
  { id: "new_lot",      label: "New lot",        defaultOn: true,  defaultTemplate: "Now, lot {lot}.",                    hints: "{lot}" },
  { id: "bid",          label: "Bid placed",     defaultOn: false, defaultTemplate: "At {amount}. Can I get {asking}?",  hints: "{lot} {amount} {asking} {platform}" },
  { id: "fair_warning", label: "Fair warning",   defaultOn: true,  defaultTemplate: "Fair warning on lot {lot}.",         hints: "{lot}" },
  { id: "lot_sold",     label: "Lot sold",       defaultOn: true,  defaultTemplate: "Sold at {hammer}.",                 hints: "{lot} {hammer}" },
  { id: "lot_passed",   label: "Lot passed",     defaultOn: false, defaultTemplate: "Lot {lot} is passed.",              hints: "{lot}" },
  { id: "paused",       label: "Auction paused", defaultOn: false, defaultTemplate: "The auction is briefly paused.",    hints: "" },
] as const

function buildDefaultFeedCfg(): Record<string, FeedEventConfig> {
  const out: Record<string, FeedEventConfig> = {}
  for (const e of FEED_EVENTS) out[e.id] = { enabled: e.defaultOn, template: e.defaultTemplate }
  return out
}

function fillFeedTemplate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? "")
}

const STATUS_LABEL: Record<Status, string> = {
  idle: "Offline", connecting: "Connecting…", connected: "Live", speaking: "Speaking…", error: "Error",
}
const STATUS_DOT: Record<Status, string> = {
  idle: "bg-gray-600", connecting: "bg-yellow-400 animate-pulse",
  connected: "bg-[#2AB4A6] animate-pulse", speaking: "bg-blue-400 animate-pulse", error: "bg-red-500",
}
const STATUS_TEXT: Record<Status, string> = {
  idle: "text-gray-400", connecting: "text-yellow-400",
  connected: "text-[#2AB4A6]", speaking: "text-blue-400", error: "text-red-400",
}

export default function AvatarPage() {
  // Avatar WebRTC refs
  const videoRef       = useRef<HTMLVideoElement>(null)
  const pcRef          = useRef<RTCPeerConnection | null>(null)
  const streamRef      = useRef<{ id: string; session_id: string } | null>(null)
  const speakTimer     = useRef<ReturnType<typeof setTimeout> | null>(null)
  const connectTimer   = useRef<ReturnType<typeof setTimeout> | null>(null)
  const keepaliveTimer = useRef<ReturnType<typeof setInterval> | null>(null)

  // Screen-reading refs — all mutable so interval callbacks are never stale
  const screenStreamRef  = useRef<MediaStream | null>(null)
  const screenVideoRef   = useRef<HTMLVideoElement | null>(null)
  const watchIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const lastLotRef       = useRef<string | null>(null)
  const isReadingRef     = useRef(false)
  const statusRef        = useRef<Status>("idle")
  const streamDataRef    = useRef<{ id: string; session_id: string } | null>(null)

  // Avatar state
  const [status,            setStatus]           = useState<Status>("idle")
  const [error,             setError]            = useState<string | null>(null)
  const [script,            setScript]           = useState("")
  const [presenters,        setPresenters]        = useState<Presenter[]>([])
  const [selectedId,        setSelectedId]        = useState<string | null>(null)
  const [loadingPresenters, setLoadingPresenters] = useState(true)

  // Auto-read state
  const [isWatching,    setIsWatching]    = useState(false)
  const [watchedLot,    setWatchedLot]    = useState<LotReading | null>(null)
  const [readingStatus, setReadingStatus] = useState<"idle" | "reading" | "error">("idle")
  const [readCount,     setReadCount]     = useState(0)
  const [lastReadRaw,   setLastReadRaw]   = useState<string | null>(null)
  const [lastSpoke,     setLastSpoke]     = useState<string | null>(null)
  const [readError,     setReadError]     = useState<string | null>(null)

  // Live Feed state
  const [feedRunning,    setFeedRunning]   = useState(false)
  const [feedConnState,  setFeedConnState] = useState<"idle" | "connecting" | "open" | "error" | "closed">("idle")
  const [feedAuctionId,  setFeedAuctionId] = useState<string>(() => {
    if (typeof window === "undefined") return ""
    return localStorage.getItem("auction_monitor_id") ?? ""
  })
  const [feedEventCfg, setFeedEventCfg] = useState<Record<string, FeedEventConfig>>(() => {
    if (typeof window === "undefined") return buildDefaultFeedCfg()
    try {
      const raw    = localStorage.getItem("avatar_feed_config")
      const parsed = raw ? JSON.parse(raw) : null
      const out: Record<string, FeedEventConfig> = {}
      for (const e of FEED_EVENTS) {
        out[e.id] = {
          enabled:  parsed?.[e.id]?.enabled  ?? e.defaultOn,
          template: parsed?.[e.id]?.template ?? e.defaultTemplate,
        }
      }
      return out
    } catch { return buildDefaultFeedCfg() }
  })
  const [feedShowCfg,    setFeedShowCfg]   = useState(false)
  const [feedCurrentLot, setFeedCurrentLot] = useState<string | null>(null)

  // Live Feed refs
  const feedWsRef            = useRef<WebSocket | null>(null)
  const feedShouldReconnRef  = useRef(false)
  const feedReconnTimerRef   = useRef<ReturnType<typeof setTimeout> | null>(null)
  const feedCurrentLotNumRef = useRef<string | null>(null)
  const feedCurrentHammerRef = useRef<number | null>(null)
  const feedFairWarningRef   = useRef(false)
  const feedPausedRef        = useRef(false)
  const feedEventCfgRef      = useRef(feedEventCfg)

  // Keep refs in sync with state
  useEffect(() => { statusRef.current = status }, [status])
  useEffect(() => { streamDataRef.current = streamRef.current }, [status])
  useEffect(() => { feedEventCfgRef.current = feedEventCfg }, [feedEventCfg])

  // Load presenters
  useEffect(() => {
    fetch("/api/avatar", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "presenters" }),
    })
      .then((r) => r.json())
      .then((data: Presenter[]) => {
        setPresenters(data)
        if (data.length > 0) setSelectedId(data[0].presenter_id ?? data[0].id ?? null)
      })
      .catch(() => {})
      .finally(() => setLoadingPresenters(false))
  }, [])

  const selectedPresenter = presenters.find((p) => (p.presenter_id ?? p.id) === selectedId)

  // ── Avatar connection ────────────────────────────────────────────────────────

  const cleanup = useCallback(async (silent = false) => {
    if (speakTimer.current)     clearTimeout(speakTimer.current)
    if (connectTimer.current)   clearTimeout(connectTimer.current)
    if (keepaliveTimer.current) clearInterval(keepaliveTimer.current)
    if (streamRef.current) {
      const { id, session_id } = streamRef.current
      if (!silent) {
        fetch("/api/avatar", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "delete", id, session_id }),
        }).catch(() => {})
      }
      streamRef.current     = null
      streamDataRef.current = null
    }
    if (pcRef.current) {
      pcRef.current.ontrack = pcRef.current.onicecandidate =
        pcRef.current.oniceconnectionstatechange = pcRef.current.onconnectionstatechange = null
      pcRef.current.close()
      pcRef.current = null
    }
    if (videoRef.current) videoRef.current.srcObject = null
  }, [])

  useEffect(() => () => { cleanup(true) }, [cleanup])

  const markConnected = useCallback(() => {
    if (connectTimer.current) clearTimeout(connectTimer.current)
    setStatus("connected")
    // Keep the D-ID stream alive every 20 s — without this it drops after ~30 s of silence
    if (keepaliveTimer.current) clearInterval(keepaliveTimer.current)
    keepaliveTimer.current = setInterval(() => {
      const sd = streamDataRef.current
      if (!sd) return
      fetch("/api/avatar", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "keepalive", id: sd.id, session_id: sd.session_id }),
      }).catch(() => {})
    }, 20_000)
  }, [])

  const connect = useCallback(async (presenterId: string) => {
    await cleanup(true)
    setStatus("connecting")
    setError(null)
    connectTimer.current = setTimeout(() => {
      setStatus("error"); setError("Connection timed out — please try again"); cleanup(true)
    }, 30_000)

    try {
      const createRes = await fetch("/api/avatar", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "create", presenterId }),
      })
      if (!createRes.ok) {
        const { error: msg } = await createRes.json().catch(() => ({}))
        throw new Error(msg ?? `HTTP ${createRes.status}`)
      }
      const data = await createRes.json()
      const { id, session_id, offer } = data

      // Normalise ICE servers — D-ID sometimes returns `url` (string) instead of `urls` (array)
      const rawIce: any[] = data.ice_servers ?? data.iceServers ?? []
      const iceServers = rawIce.map((s) => ({
        ...s,
        urls: s.urls ?? (s.url ? [s.url] : []),
      }))

      streamRef.current     = { id, session_id }
      streamDataRef.current = { id, session_id }

      const pc = new RTCPeerConnection({ iceServers })
      pcRef.current = pc

      pc.ontrack = (event) => {
        if (videoRef.current && event.streams[0]) {
          videoRef.current.srcObject = event.streams[0]
          videoRef.current.play().catch(() => {})
        }
        markConnected()
      }
      pc.onconnectionstatechange = () => {
        const s = pc.connectionState
        if (s === "connected") markConnected()
        if (s === "failed") {
          setStatus("error")
          setError(`WebRTC failed (ICE: ${pc.iceConnectionState}) — click Connect to retry`)
          cleanup(true)
        }
        if (s === "closed") {
          if (statusRef.current !== "idle") { setStatus("error"); setError("Stream closed unexpectedly") }
        }
      }
      pc.oniceconnectionstatechange = () => {
        const s = pc.iceConnectionState
        if (s === "connected" || s === "completed") markConnected()
        if (s === "failed") {
          setStatus("error")
          setError("ICE connection failed — check network or try again")
          cleanup(true)
        }
      }
      pc.onicecandidate = (event) => {
        if (!event.candidate || !streamRef.current) return
        fetch("/api/avatar", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "ice", id, session_id, candidate: event.candidate }),
        }).catch(() => {})
      }

      await pc.setRemoteDescription(new RTCSessionDescription(offer))
      const answer = await pc.createAnswer()
      await pc.setLocalDescription(answer)
      const sdpRes = await fetch("/api/avatar", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "sdp", id, session_id, answer: { type: answer.type, sdp: answer.sdp } }),
      })
      if (!sdpRes.ok) throw new Error("SDP exchange failed")

    } catch (err) {
      if (connectTimer.current) clearTimeout(connectTimer.current)
      setStatus("error"); setError(err instanceof Error ? err.message : "Connection failed"); cleanup(true)
    }
  }, [cleanup, markConnected])

  const handleSelectPresenter = useCallback((p: Presenter) => {
    setSelectedId(p.presenter_id ?? p.id ?? null)
    if (status === "connected" || status === "speaking" || status === "connecting") {
      cleanup().then(() => setStatus("idle"))
    }
  }, [status, cleanup])

  const disconnect = useCallback(async () => { await cleanup(); setStatus("idle") }, [cleanup])

  // ── Speaking ─────────────────────────────────────────────────────────────────

  const speakTextDirect = useCallback(async (text: string) => {
    const sd = streamDataRef.current
    if (!sd || statusRef.current !== "connected") return
    setStatus("speaking")
    try {
      const res = await fetch("/api/avatar", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "speak", id: sd.id, session_id: sd.session_id, text }),
      })
      if (!res.ok) {
        const { error: msg } = await res.json().catch(() => ({}))
        throw new Error(msg ?? "Speak failed")
      }
      setLastSpoke(new Date().toLocaleTimeString())
      const words = text.split(/\s+/).length
      speakTimer.current = setTimeout(
        () => setStatus("connected"),
        Math.ceil((words / 140) * 60_000) + 2_000,
      )
    } catch (err) {
      setStatus("error"); setError(err instanceof Error ? err.message : "Failed to speak")
    }
  }, [])

  const speak = useCallback(() => {
    if (script.trim().length >= 3) speakTextDirect(script.trim())
  }, [script, speakTextDirect])

  // ── Screen reading ────────────────────────────────────────────────────────────

  const stopWatching = useCallback(() => {
    if (watchIntervalRef.current) clearInterval(watchIntervalRef.current)
    screenStreamRef.current?.getTracks().forEach((t) => t.stop())
    screenStreamRef.current = null
    screenVideoRef.current  = null
    isReadingRef.current    = false
    lastLotRef.current      = null
    setIsWatching(false)
    setWatchedLot(null)
    setReadingStatus("idle")
    setLastReadRaw(null)
    setReadCount(0)
    setLastSpoke(null)
    setReadError(null)
  }, [])

  const doCapture = useCallback(async () => {
    if (isReadingRef.current) return
    const vid = screenVideoRef.current
    if (!vid || !vid.videoWidth) return

    isReadingRef.current = true
    setReadingStatus("reading")
    setReadError(null)

    try {
      // Downscale to max 1280px wide so Gemini gets a fast, clear image
      const MAX_W = 1280
      const scale = Math.min(1, MAX_W / vid.videoWidth)
      const canvas = document.createElement("canvas")
      canvas.width  = Math.round(vid.videoWidth  * scale)
      canvas.height = Math.round(vid.videoHeight * scale)
      canvas.getContext("2d")?.drawImage(vid, 0, 0, canvas.width, canvas.height)
      const base64 = canvas.toDataURL("image/jpeg", 0.85).split(",")[1]

      const res = await fetch("/api/avatar/read-lot", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imageBase64: base64 }),
      })

      setReadCount((c) => c + 1)

      if (!res.ok) {
        const txt = await res.text().catch(() => `HTTP ${res.status}`)
        setReadError(`API error: ${txt}`)
        setReadingStatus("error")
        return
      }

      const data: LotReading = await res.json()
      setReadingStatus("idle")
      setLastReadRaw(JSON.stringify(data))

      if (!data.lotNumber) return
      setWatchedLot(data)

      if (data.lotNumber !== lastLotRef.current) {
        lastLotRef.current = data.lotNumber

        const parts = [`Lot ${data.lotNumber}.`]
        if (data.askingBid)  parts.push(`Asking bid ${data.askingBid}.`)
        if (data.currentBid) parts.push(`Current bid ${data.currentBid}.`)

        if (streamDataRef.current && statusRef.current === "connected") {
          speakTextDirect(parts.join(" "))
        }
      }
    } catch (err) {
      setReadError(err instanceof Error ? err.message : "Capture failed")
      setReadingStatus("error")
    } finally {
      isReadingRef.current = false
    }
  }, [speakTextDirect])

  const doCaptureRef = useRef(doCapture)
  useEffect(() => { doCaptureRef.current = doCapture }, [doCapture])

  const startWatching = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: 2 }, audio: false,
      } as DisplayMediaStreamOptions)

      screenStreamRef.current = stream

      const vid = document.createElement("video")
      vid.srcObject = stream
      vid.muted     = true

      await new Promise<void>((resolve) => {
        if (vid.readyState >= 1) { resolve(); return }
        vid.addEventListener("loadedmetadata", () => resolve(), { once: true })
      })
      await vid.play()
      screenVideoRef.current = vid

      lastLotRef.current = null
      setIsWatching(true)
      setWatchedLot(null)
      setLastReadRaw(null)
      setReadCount(0)
      setLastSpoke(null)
      setReadError(null)

      doCaptureRef.current()
      watchIntervalRef.current = setInterval(() => doCaptureRef.current(), 4_000)
      stream.getVideoTracks()[0].addEventListener("ended", stopWatching)
    } catch {
      // User cancelled share picker — ignore
    }
  }, [stopWatching])

  // ── Live Feed helpers ───────────────────────────────────────────────────────

  function updateFeedCfg(id: string, patch: Partial<FeedEventConfig>) {
    setFeedEventCfg(prev => {
      const next = { ...prev, [id]: { ...prev[id], ...patch } }
      try { localStorage.setItem("avatar_feed_config", JSON.stringify(next)) } catch {}
      return next
    })
  }

  // ── Live Feed WebSocket ──────────────────────────────────────────────────────

  useEffect(() => {
    if (!feedRunning) {
      feedShouldReconnRef.current = false
      try { feedWsRef.current?.close() } catch {}
      feedWsRef.current = null
      if (feedReconnTimerRef.current) clearTimeout(feedReconnTimerRef.current)
      setFeedConnState("idle")
      setFeedCurrentLot(null)
      feedCurrentLotNumRef.current = null
      feedCurrentHammerRef.current = null
      feedFairWarningRef.current   = false
      feedPausedRef.current        = false
      return
    }

    const id = feedAuctionId.trim()
    if (!id) { setFeedRunning(false); return }

    feedShouldReconnRef.current  = true
    localStorage.setItem("auction_monitor_id", id)
    feedCurrentLotNumRef.current = null
    feedCurrentHammerRef.current = null
    feedFairWarningRef.current   = false
    feedPausedRef.current        = false

    const url = `wss://www.vectis.co.uk/wss/${id}`

    function openFeed() {
      if (!feedShouldReconnRef.current) return
      setFeedConnState("connecting")
      try {
        const ws = new WebSocket(url)
        feedWsRef.current = ws

        ws.onopen  = () => setFeedConnState("open")
        ws.onerror = () => setFeedConnState("error")
        ws.onclose = () => {
          feedWsRef.current = null
          setFeedConnState("closed")
          if (feedShouldReconnRef.current)
            feedReconnTimerRef.current = setTimeout(openFeed, 5_000)
        }

        ws.onmessage = (ev) => {
          let parsed: any = null
          try { parsed = JSON.parse(ev.data) } catch { return }
          const cmd = parsed?.command
          const c   = parsed?.content ?? {}
          const cfg = feedEventCfgRef.current

          function trySpeak(text: string) {
            const t = text.trim()
            if (t && statusRef.current === "connected") speakTextDirect(t)
          }

          // ── activeLotChange: announce previous lot outcome then new lot ──────
          if (cmd === "activeLotChange") {
            const prevNum    = feedCurrentLotNumRef.current
            const prevHammer = feedCurrentHammerRef.current

            if (prevNum && c.previous_lot_type) {
              if (/sold/i.test(String(c.previous_lot_type))) {
                if (cfg.lot_sold?.enabled)
                  trySpeak(fillFeedTemplate(cfg.lot_sold.template, {
                    lot:    prevNum,
                    hammer: prevHammer != null ? `£${prevHammer.toLocaleString()}` : "",
                  }))
              } else if (/pass|unsold|withdrawn/i.test(String(c.previous_lot_type))) {
                if (cfg.lot_passed?.enabled)
                  trySpeak(fillFeedTemplate(cfg.lot_passed.template, { lot: prevNum }))
              }
            }

            if (c.lot_number) {
              const newLot = String(c.lot_number)
              feedCurrentLotNumRef.current = newLot
              feedCurrentHammerRef.current = null
              feedFairWarningRef.current   = false
              setFeedCurrentLot(newLot)
              if (cfg.new_lot?.enabled)
                trySpeak(fillFeedTemplate(cfg.new_lot.template, { lot: newLot }))
            }
          }

          // ── lotInformationUpdate: track hammer price ──────────────────────────
          if (cmd === "lotInformationUpdate" && c.hammer_price != null) {
            const hp = parseFloat(String(c.hammer_price))
            if (!isNaN(hp)) feedCurrentHammerRef.current = hp
          }

          // ── liveBidEvent ──────────────────────────────────────────────────────
          if (cmd === "liveBidEvent" && cfg.bid?.enabled) {
            trySpeak(fillFeedTemplate(cfg.bid.template, {
              lot:      feedCurrentLotNumRef.current ?? String(c.lot_id ?? ""),
              amount:   c.amount  != null ? `£${Number(c.amount).toLocaleString()}`  : "",
              asking:   c.asking  != null ? `£${Number(c.asking).toLocaleString()}`  : "",
              platform: String(c.platform ?? ""),
            }))
          }

          // ── getFairWarningStatus: fair warning + paused ───────────────────────
          if (cmd === "getFairWarningStatus") {
            if (c.fair_warning && !feedFairWarningRef.current) {
              feedFairWarningRef.current = true
              if (cfg.fair_warning?.enabled)
                trySpeak(fillFeedTemplate(cfg.fair_warning.template, {
                  lot: feedCurrentLotNumRef.current ?? "",
                }))
            } else if (!c.fair_warning) {
              feedFairWarningRef.current = false
            }

            if (c.paused && !feedPausedRef.current) {
              feedPausedRef.current = true
              if (cfg.paused?.enabled)
                trySpeak(fillFeedTemplate(cfg.paused.template, {}))
            } else if (!c.paused) {
              feedPausedRef.current = false
            }
          }
        }
      } catch {
        setFeedConnState("error")
        if (feedShouldReconnRef.current)
          feedReconnTimerRef.current = setTimeout(openFeed, 5_000)
      }
    }

    openFeed()

    return () => {
      feedShouldReconnRef.current = false
      try { feedWsRef.current?.close() } catch {}
      feedWsRef.current = null
      if (feedReconnTimerRef.current) clearTimeout(feedReconnTimerRef.current)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [feedRunning, feedAuctionId, speakTextDirect])

  const isLive = status === "connected" || status === "speaking"

  return (
    <div className="min-h-screen bg-[#1C1C1E] flex flex-col">
      <div className="flex items-center justify-between px-6 py-4 border-b border-gray-800">
        <div>
          <h1 className="text-xl font-bold text-white tracking-tight">AI Presenter</h1>
          <p className="text-xs text-gray-500 mt-0.5">Realistic avatar presenter for auction lot descriptions</p>
        </div>
        <div className="flex items-center gap-2 text-xs">
          <span className={`w-2 h-2 rounded-full ${STATUS_DOT[status]}`} />
          <span className={STATUS_TEXT[status]}>{STATUS_LABEL[status]}</span>
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* Avatar panel */}
        <div className="flex-1 flex items-center justify-center p-8 bg-[#111113]">
          <div
            className={`relative w-full max-w-2xl rounded-2xl overflow-hidden transition-all duration-700 ${
              isLive ? "border-2 border-[#2AB4A6] shadow-[0_0_40px_rgba(42,180,166,0.25)]" : "border-2 border-gray-800"
            }`}
            style={{ aspectRatio: "16/9" }}
          >
            <video ref={videoRef} autoPlay playsInline
              onLoadedMetadata={() => videoRef.current?.play().catch(() => {})}
              className={`absolute inset-0 w-full h-full object-cover transition-opacity duration-700 ${isLive ? "opacity-100" : "opacity-0"}`}
            />

            {!isLive && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-5 bg-[#0D0D0F]">
                {selectedPresenter && status === "idle" ? (
                  <img src={selectedPresenter.thumbnail_url} alt={selectedPresenter.name}
                    className="w-32 h-32 rounded-full object-cover border-2 border-gray-700 opacity-40" />
                ) : (
                  <div className={`w-28 h-28 rounded-full border-2 flex items-center justify-center ${
                    status === "connecting" ? "border-yellow-500/40 bg-yellow-500/5 animate-pulse"
                    : status === "error"   ? "border-red-500/40 bg-red-500/5"
                    : "border-gray-700 bg-gray-800/30"}`}>
                    <span className="text-5xl">{status === "error" ? "⚠️" : "🎙️"}</span>
                  </div>
                )}
                <div className="text-center px-8">
                  {status === "error" && error ? (
                    <><p className="text-red-400 text-sm font-medium">Connection error</p>
                    <p className="text-gray-500 text-xs mt-1">{error}</p></>
                  ) : status === "connecting" ? (
                    <p className="text-yellow-400/80 text-sm">Establishing stream…</p>
                  ) : (
                    <p className="text-gray-600 text-sm">
                      {selectedPresenter ? `${selectedPresenter.name} — click Connect to start` : "Select a presenter and connect"}
                    </p>
                  )}
                </div>
              </div>
            )}

            {status === "speaking" && (
              <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex items-center gap-1.5 bg-black/70 backdrop-blur-sm rounded-full px-4 py-1.5">
                {[1,2,3,4].map((i) => (
                  <div key={i} className="w-1 rounded-full bg-[#2AB4A6]"
                    style={{ height: `${8+i*4}px`, animation: `wavebar 0.6s ease-in-out ${i*0.1}s infinite alternate` }} />
                ))}
                <span className="text-[#2AB4A6] text-xs font-medium ml-1.5">Speaking</span>
              </div>
            )}

            {isWatching && watchedLot?.lotNumber && (
              <div className="absolute top-3 left-3 bg-black/70 backdrop-blur-sm rounded-lg px-3 py-1.5">
                <p className="text-white text-sm font-bold">Lot {watchedLot.lotNumber}</p>
                {watchedLot.askingBid && <p className="text-[#2AB4A6] text-xs">Asking {watchedLot.askingBid}</p>}
              </div>
            )}
          </div>
        </div>

        {/* Controls */}
        <div className="w-80 flex-shrink-0 border-l border-gray-800 bg-[#1C1C1E] flex flex-col p-5 gap-4 overflow-y-auto">

          {/* Presenter */}
          <div className="bg-[#2C2C2E] rounded-xl p-4 border border-gray-800">
            <h2 className="text-gray-400 text-xs font-semibold uppercase tracking-widest mb-3">Presenter</h2>
            {loadingPresenters ? <p className="text-gray-600 text-xs text-center py-2">Loading…</p>
            : presenters.length === 0 ? <p className="text-red-400 text-xs">Could not load presenters</p>
            : (
              <div className="grid grid-cols-3 gap-2">
                {presenters.map((p) => {
                  const pid = p.presenter_id ?? p.id ?? ""
                  return (
                    <button key={pid} onClick={() => handleSelectPresenter(p)} title={p.name}
                      className={`relative rounded-lg overflow-hidden aspect-square transition-all ${
                        selectedId === pid
                          ? "ring-2 ring-[#2AB4A6] ring-offset-1 ring-offset-[#2C2C2E] opacity-100"
                          : "ring-1 ring-gray-700 hover:ring-gray-500 opacity-50 hover:opacity-80"
                      }`}>
                      <img src={p.thumbnail_url} alt={p.name} className="w-full h-full object-cover" />
                      {selectedId === pid && <div className="absolute inset-0 bg-[#2AB4A6]/10" />}
                    </button>
                  )
                })}
              </div>
            )}
            {selectedPresenter && (
              <p className="text-[#2AB4A6] text-xs text-center mt-2 font-medium">{selectedPresenter.name}</p>
            )}
          </div>

          {/* Connection */}
          <div className="bg-[#2C2C2E] rounded-xl p-4 border border-gray-800">
            <h2 className="text-gray-400 text-xs font-semibold uppercase tracking-widest mb-3">Connection</h2>
            {status === "idle" || status === "error" ? (
              <button
                onClick={() => selectedPresenter && connect(selectedPresenter.presenter_id ?? selectedPresenter.id ?? "")}
                disabled={!selectedPresenter || loadingPresenters}
                className="w-full py-2.5 bg-[#2AB4A6] hover:bg-[#22a090] text-black font-semibold rounded-lg transition-colors text-sm disabled:opacity-40 disabled:cursor-not-allowed"
              >Connect Avatar</button>
            ) : (
              <button onClick={disconnect}
                className="w-full py-2.5 bg-gray-700 hover:bg-gray-600 text-white font-semibold rounded-lg transition-colors text-sm">
                {status === "connecting" ? "Cancel" : "Disconnect"}
              </button>
            )}
            {status === "connecting" && <p className="text-yellow-400/70 text-xs text-center mt-2">Takes a few seconds…</p>}
          </div>

          {/* Auto-Read */}
          <div className="bg-[#2C2C2E] rounded-xl p-4 border border-gray-800">
            <div className="flex items-center justify-between mb-1">
              <h2 className="text-gray-400 text-xs font-semibold uppercase tracking-widest">Auto-Read</h2>
              {isWatching && (
                <span className={`text-xs flex items-center gap-1 ${
                  readingStatus === "error" ? "text-red-400" :
                  readingStatus === "reading" ? "text-yellow-400" : "text-[#2AB4A6]"}`}>
                  <span className={`w-1.5 h-1.5 rounded-full ${
                    readingStatus === "error" ? "bg-red-400" :
                    readingStatus === "reading" ? "bg-yellow-400 animate-pulse" : "bg-[#2AB4A6] animate-pulse"}`} />
                  {readingStatus === "error" ? "Error" : readingStatus === "reading" ? "Reading…" : "Watching"}
                </span>
              )}
            </div>
            <p className="text-gray-600 text-xs mb-3 leading-relaxed">
              Share the auction tab — avatar auto-speaks each new lot.
            </p>
            {!isWatching ? (
              <button onClick={startWatching} disabled={!isLive}
                className="w-full py-2.5 bg-fuchsia-600 hover:bg-fuchsia-500 text-white font-semibold rounded-lg transition-colors text-sm disabled:opacity-30 disabled:cursor-not-allowed">
                🖥️  Share Screen
              </button>
            ) : (
              <button onClick={stopWatching}
                className="w-full py-2.5 bg-gray-700 hover:bg-gray-600 text-white font-semibold rounded-lg transition-colors text-sm">
                Stop Watching
              </button>
            )}
            {!isLive && !isWatching && <p className="text-gray-600 text-xs text-center mt-2">Connect avatar first</p>}

            {/* Debug panel — always visible when watching */}
            {isWatching && (
              <div className="mt-3 space-y-2">
                {/* Live lot data */}
                <div className="bg-[#111113] rounded-lg p-3 border border-gray-700 space-y-1">
                  <div className="flex justify-between text-xs">
                    <span className="text-gray-500">Reads done</span>
                    <span className="text-gray-300 font-mono">{readCount}</span>
                  </div>
                  <div className="flex justify-between text-xs">
                    <span className="text-gray-500">Lot seen</span>
                    <span className="text-white font-bold">{watchedLot?.lotNumber ?? "—"}</span>
                  </div>
                  <div className="flex justify-between text-xs">
                    <span className="text-gray-500">Current bid</span>
                    <span className="text-white">{watchedLot?.currentBid ?? "—"}</span>
                  </div>
                  <div className="flex justify-between text-xs">
                    <span className="text-gray-500">Asking bid</span>
                    <span className="text-[#2AB4A6] font-medium">{watchedLot?.askingBid ?? "—"}</span>
                  </div>
                  {lastSpoke && (
                    <div className="flex justify-between text-xs pt-1 border-t border-gray-800">
                      <span className="text-gray-500">Last spoke</span>
                      <span className="text-green-400">{lastSpoke}</span>
                    </div>
                  )}
                </div>

                {/* Raw Gemini response */}
                {lastReadRaw && (
                  <p className="text-gray-600 text-[10px] font-mono break-all leading-relaxed">
                    Gemini: {lastReadRaw}
                  </p>
                )}

                {/* Error message */}
                {readError && (
                  <p className="text-red-400 text-xs break-words">⚠ {readError}</p>
                )}
              </div>
            )}
          </div>

          {/* Live Feed */}
          <div className="bg-[#2C2C2E] rounded-xl p-4 border border-gray-800">
            <div className="flex items-center justify-between mb-1">
              <h2 className="text-gray-400 text-xs font-semibold uppercase tracking-widest">Live Feed</h2>
              <span className={`text-xs flex items-center gap-1 ${
                feedConnState === "open"       ? "text-[#2AB4A6]"  :
                feedConnState === "connecting" ? "text-yellow-400" :
                feedConnState === "error" || feedConnState === "closed" ? "text-red-400" : "text-gray-600"
              }`}>
                <span className={`w-1.5 h-1.5 rounded-full ${
                  feedConnState === "open"       ? "bg-[#2AB4A6] animate-pulse"  :
                  feedConnState === "connecting" ? "bg-yellow-400 animate-pulse" :
                  feedConnState === "error" || feedConnState === "closed" ? "bg-red-400" : "bg-gray-600"
                }`} />
                {feedConnState === "open"       ? "Live"           :
                 feedConnState === "connecting" ? "Connecting…"    :
                 feedConnState === "error"      ? "Error"          :
                 feedConnState === "closed"     ? "Reconnecting…"  : "Offline"}
              </span>
            </div>
            <p className="text-gray-600 text-xs mb-3 leading-relaxed">
              Connect directly to the auction WebSocket — avatar speaks each event automatically.
            </p>

            <input
              type="text"
              value={feedAuctionId}
              onChange={e => setFeedAuctionId(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter" && !feedRunning && feedAuctionId.trim()) setFeedRunning(true) }}
              placeholder="Auction ID e.g. 1386"
              disabled={feedRunning}
              className="w-full mb-2 text-xs bg-[#111113] text-white border border-gray-700 rounded-md px-2 py-1.5 font-mono focus:border-[#2AB4A6] focus:outline-none disabled:opacity-50"
            />

            {!feedRunning ? (
              <button
                onClick={() => { if (feedAuctionId.trim()) setFeedRunning(true) }}
                disabled={!feedAuctionId.trim() || !isLive}
                className="w-full py-2 bg-[#2AB4A6] hover:bg-[#22a090] text-black font-semibold rounded-lg text-xs transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
              >🔴 Connect to Feed</button>
            ) : (
              <button
                onClick={() => setFeedRunning(false)}
                className="w-full py-2 bg-gray-700 hover:bg-gray-600 text-white font-semibold rounded-lg text-xs transition-colors"
              >Disconnect Feed</button>
            )}

            {!isLive && !feedRunning && (
              <p className="text-gray-600 text-xs text-center mt-2">Connect avatar first</p>
            )}
            {feedRunning && feedCurrentLot && (
              <p className="text-[#2AB4A6] text-xs text-center mt-2 font-medium font-mono">Lot {feedCurrentLot}</p>
            )}

            {/* Event configuration */}
            <div className="mt-3 pt-3 border-t border-gray-700">
              <button
                onClick={() => setFeedShowCfg(s => !s)}
                className="text-xs text-gray-500 hover:text-gray-300 w-full text-left flex items-center justify-between"
              >
                <span>{feedShowCfg ? "▼" : "▶"} Configure events</span>
                <span className="text-gray-600">
                  {FEED_EVENTS.filter(e => feedEventCfg[e.id]?.enabled ?? e.defaultOn).length}/{FEED_EVENTS.length} on
                </span>
              </button>

              {feedShowCfg && (
                <div className="mt-3 space-y-3">
                  {FEED_EVENTS.map(e => {
                    const cfg = feedEventCfg[e.id]
                    const enabled = cfg?.enabled ?? e.defaultOn
                    return (
                      <div key={e.id} className={`rounded-lg p-2.5 border ${enabled ? "border-gray-600 bg-[#111113]" : "border-gray-700 bg-[#0D0D0F] opacity-60"}`}>
                        <div className="flex items-center gap-2 mb-1.5">
                          <input
                            type="checkbox"
                            checked={enabled}
                            onChange={ev => updateFeedCfg(e.id, { enabled: ev.target.checked })}
                            className="w-3.5 h-3.5 accent-[#2AB4A6] flex-shrink-0"
                          />
                          <span className="text-xs text-gray-200 font-medium flex-1">{e.label}</span>
                          {e.hints && (
                            <span className="text-[10px] text-gray-600 font-mono">{e.hints}</span>
                          )}
                        </div>
                        <input
                          type="text"
                          value={cfg?.template ?? e.defaultTemplate}
                          onChange={ev => updateFeedCfg(e.id, { template: ev.target.value })}
                          disabled={!enabled}
                          className="w-full text-[11px] bg-[#1C1C1E] text-gray-300 border border-gray-700 rounded px-2 py-1 font-mono disabled:opacity-40 focus:border-[#2AB4A6] focus:outline-none"
                        />
                      </div>
                    )
                  })}
                  <button
                    onClick={() => {
                      const d = buildDefaultFeedCfg()
                      setFeedEventCfg(d)
                      try { localStorage.setItem("avatar_feed_config", JSON.stringify(d)) } catch {}
                    }}
                    className="text-[10px] text-gray-600 hover:text-gray-400 w-full text-right pt-1"
                  >Reset to defaults</button>
                </div>
              )}
            </div>
          </div>

          {/* Manual Script */}
          <div className="bg-[#2C2C2E] rounded-xl p-4 border border-gray-800 flex flex-col">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-gray-400 text-xs font-semibold uppercase tracking-widest">Manual Script</h2>
              <span className={`text-xs ${script.length > 3000 ? "text-red-400" : "text-gray-600"}`}>{script.length}</span>
            </div>
            <textarea value={script} onChange={(e) => setScript(e.target.value)}
              placeholder="Or type a manual script and click Speak…"
              className="min-h-[100px] bg-[#111113] text-white text-sm rounded-lg p-3 border border-gray-700 focus:border-[#2AB4A6] focus:outline-none resize-none placeholder-gray-700 leading-relaxed"
              maxLength={5000} />
            <div className="mt-3 flex gap-2">
              <button onClick={speak} disabled={status !== "connected" || script.trim().length < 3}
                className="flex-1 py-2.5 bg-[#2AB4A6] hover:bg-[#22a090] text-black font-semibold rounded-lg transition-colors text-sm disabled:opacity-30 disabled:cursor-not-allowed flex items-center justify-center gap-2">
                {status === "speaking"
                  ? <><span className="inline-block w-3 h-3 border-2 border-black border-t-transparent rounded-full animate-spin" />Speaking…</>
                  : "▶ Speak"}
              </button>
              {script && <button onClick={() => setScript("")} className="px-3 text-gray-600 hover:text-gray-400 text-xs">Clear</button>}
            </div>
          </div>
        </div>
      </div>

      <style>{`
        @keyframes wavebar { from { transform: scaleY(0.6); } to { transform: scaleY(1.4); } }
      `}</style>
    </div>
  )
}
