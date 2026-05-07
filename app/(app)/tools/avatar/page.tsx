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
  lotNumber:   string | null
  currentBid:  string | null
  askingBid:   string | null
}

const STATUS_LABEL: Record<Status, string> = {
  idle:       "Offline",
  connecting: "Connecting…",
  connected:  "Live",
  speaking:   "Speaking…",
  error:      "Error",
}

const STATUS_DOT: Record<Status, string> = {
  idle:       "bg-gray-600",
  connecting: "bg-yellow-400 animate-pulse",
  connected:  "bg-[#2AB4A6] animate-pulse",
  speaking:   "bg-blue-400 animate-pulse",
  error:      "bg-red-500",
}

const STATUS_TEXT: Record<Status, string> = {
  idle:       "text-gray-400",
  connecting: "text-yellow-400",
  connected:  "text-[#2AB4A6]",
  speaking:   "text-blue-400",
  error:      "text-red-400",
}

export default function AvatarPage() {
  // Avatar WebRTC refs
  const videoRef     = useRef<HTMLVideoElement>(null)
  const pcRef        = useRef<RTCPeerConnection | null>(null)
  const streamRef    = useRef<{ id: string; session_id: string } | null>(null)
  const speakTimer   = useRef<ReturnType<typeof setTimeout> | null>(null)
  const connectTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Screen-reading refs
  const screenStreamRef  = useRef<MediaStream | null>(null)
  const screenVideoRef   = useRef<HTMLVideoElement | null>(null)
  const watchIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const lastLotRef       = useRef<string | null>(null)
  const isReadingRef     = useRef(false) // prevent overlapping Gemini calls

  // Avatar state
  const [status,     setStatus]     = useState<Status>("idle")
  const [error,      setError]      = useState<string | null>(null)
  const [script,     setScript]     = useState("")
  const [presenters, setPresenters] = useState<Presenter[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [loadingPresenters, setLoadingPresenters] = useState(true)

  // Auto-read state
  const [isWatching,   setIsWatching]   = useState(false)
  const [watchedLot,   setWatchedLot]   = useState<LotReading | null>(null)
  const [readingStatus, setReadingStatus] = useState<"idle" | "reading" | "error">("idle")

  // Load presenters on mount
  useEffect(() => {
    fetch("/api/avatar", {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ action: "presenters" }),
    })
      .then((r) => r.json())
      .then((data: Presenter[]) => {
        setPresenters(data)
        if (data.length > 0) setSelectedId(data[0].presenter_id ?? data[0].id ?? null)
      })
      .catch(() => {})
      .finally(() => setLoadingPresenters(false))
  }, [])

  const selectedPresenter = presenters.find(
    (p) => (p.presenter_id ?? p.id) === selectedId,
  )

  // ── Avatar connection ────────────────────────────────────────────────────────

  const cleanup = useCallback(async (silent = false) => {
    if (speakTimer.current)   clearTimeout(speakTimer.current)
    if (connectTimer.current) clearTimeout(connectTimer.current)

    if (streamRef.current) {
      const { id, session_id } = streamRef.current
      if (!silent) {
        fetch("/api/avatar", {
          method:  "POST",
          headers: { "Content-Type": "application/json" },
          body:    JSON.stringify({ action: "delete", id, session_id }),
        }).catch(() => {})
      }
      streamRef.current = null
    }

    if (pcRef.current) {
      pcRef.current.ontrack                    = null
      pcRef.current.onicecandidate             = null
      pcRef.current.oniceconnectionstatechange = null
      pcRef.current.onconnectionstatechange    = null
      pcRef.current.close()
      pcRef.current = null
    }

    if (videoRef.current) videoRef.current.srcObject = null
  }, [])

  useEffect(() => () => { cleanup(true) }, [cleanup])

  const markConnected = useCallback(() => {
    if (connectTimer.current) clearTimeout(connectTimer.current)
    setStatus("connected")
  }, [])

  const connect = useCallback(async (presenterUrl: string) => {
    await cleanup(true)
    setStatus("connecting")
    setError(null)

    connectTimer.current = setTimeout(() => {
      setStatus("error")
      setError("Connection timed out — please try again")
      cleanup(true)
    }, 30_000)

    try {
      const createRes = await fetch("/api/avatar", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ action: "create", presenterUrl }),
      })

      if (!createRes.ok) {
        const { error: msg } = await createRes.json().catch(() => ({}))
        throw new Error(msg ?? `HTTP ${createRes.status}`)
      }

      const data = await createRes.json()
      const { id, session_id, offer } = data
      const iceServers = data.ice_servers ?? data.iceServers ?? []
      streamRef.current = { id, session_id }

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
        if (pc.connectionState === "connected") markConnected()
        if (pc.connectionState === "failed" || pc.connectionState === "closed") {
          setStatus("error")
          setError("WebRTC connection failed")
          cleanup(true)
        }
      }

      pc.oniceconnectionstatechange = () => {
        const s = pc.iceConnectionState
        if (s === "connected" || s === "completed") markConnected()
        if (s === "failed") {
          setStatus("error")
          setError("ICE connection failed — try again")
          cleanup(true)
        }
      }

      pc.onicecandidate = (event) => {
        if (!event.candidate || !streamRef.current) return
        fetch("/api/avatar", {
          method:  "POST",
          headers: { "Content-Type": "application/json" },
          body:    JSON.stringify({ action: "ice", id, session_id, candidate: event.candidate }),
        }).catch(() => {})
      }

      await pc.setRemoteDescription(new RTCSessionDescription(offer))
      const answer = await pc.createAnswer()
      await pc.setLocalDescription(answer)

      const sdpRes = await fetch("/api/avatar", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({
          action: "sdp", id, session_id,
          answer: { type: answer.type, sdp: answer.sdp },
        }),
      })

      if (!sdpRes.ok) throw new Error("SDP exchange failed")

    } catch (err) {
      if (connectTimer.current) clearTimeout(connectTimer.current)
      setStatus("error")
      setError(err instanceof Error ? err.message : "Connection failed")
      cleanup(true)
    }
  }, [cleanup, markConnected])

  const handleSelectPresenter = useCallback((p: Presenter) => {
    setSelectedId(p.presenter_id ?? p.id ?? null)
    if (status === "connected" || status === "speaking" || status === "connecting") {
      cleanup().then(() => setStatus("idle"))
    }
  }, [status, cleanup])

  const disconnect = useCallback(async () => {
    await cleanup()
    setStatus("idle")
  }, [cleanup])

  // ── Speaking ─────────────────────────────────────────────────────────────────

  const speakText = useCallback(async (text: string) => {
    if (!streamRef.current || status !== "connected") return

    setStatus("speaking")
    const { id, session_id } = streamRef.current

    try {
      const res = await fetch("/api/avatar", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ action: "speak", id, session_id, text }),
      })

      if (!res.ok) {
        const { error: msg } = await res.json().catch(() => ({}))
        throw new Error(msg ?? "Speak failed")
      }

      const words = text.split(/\s+/).length
      speakTimer.current = setTimeout(
        () => setStatus("connected"),
        Math.ceil((words / 140) * 60_000) + 2_000,
      )
    } catch (err) {
      setStatus("error")
      setError(err instanceof Error ? err.message : "Failed to speak")
    }
  }, [status])

  const speak = useCallback(() => {
    if (script.trim().length >= 3) speakText(script.trim())
  }, [script, speakText])

  // ── Screen reading ────────────────────────────────────────────────────────────

  const stopWatching = useCallback(() => {
    if (watchIntervalRef.current) clearInterval(watchIntervalRef.current)
    if (screenStreamRef.current) {
      screenStreamRef.current.getTracks().forEach((t) => t.stop())
      screenStreamRef.current = null
    }
    screenVideoRef.current = null
    isReadingRef.current    = false
    lastLotRef.current      = null
    setIsWatching(false)
    setWatchedLot(null)
    setReadingStatus("idle")
  }, [])

  const captureAndRead = useCallback(async () => {
    if (isReadingRef.current || !screenVideoRef.current) return
    isReadingRef.current = true
    setReadingStatus("reading")

    try {
      const vid = screenVideoRef.current
      const canvas = document.createElement("canvas")
      canvas.width  = vid.videoWidth  || 1280
      canvas.height = vid.videoHeight || 720
      canvas.getContext("2d")?.drawImage(vid, 0, 0)
      const base64 = canvas.toDataURL("image/jpeg", 0.75).split(",")[1]

      const res = await fetch("/api/avatar/read-lot", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ imageBase64: base64 }),
      })

      if (!res.ok) { setReadingStatus("error"); return }

      const data: LotReading = await res.json()
      setReadingStatus("idle")

      if (!data.lotNumber) return

      setWatchedLot(data)

      // Auto-speak when lot number changes
      if (data.lotNumber !== lastLotRef.current) {
        lastLotRef.current = data.lotNumber

        const parts: string[] = [`Lot ${data.lotNumber}.`]
        if (data.askingBid)  parts.push(`Asking bid ${data.askingBid}.`)
        if (data.currentBid) parts.push(`Current bid ${data.currentBid}.`)
        const line = parts.join(" ")

        // Queue speak — waits if currently speaking
        const trySpeak = () => {
          if (streamRef.current && status === "connected") {
            speakText(line)
          } else if (status === "speaking") {
            setTimeout(trySpeak, 2_000)
          }
        }
        trySpeak()
      }
    } catch {
      setReadingStatus("error")
    } finally {
      isReadingRef.current = false
    }
  }, [speakText, status])

  const startWatching = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: 2 },
        audio: false,
      } as DisplayMediaStreamOptions)

      screenStreamRef.current = stream

      const vid = document.createElement("video")
      vid.srcObject = stream
      vid.muted     = true
      await vid.play()
      screenVideoRef.current = vid

      lastLotRef.current = null
      setIsWatching(true)
      setWatchedLot(null)

      // Read immediately, then every 4 seconds
      captureAndRead()
      watchIntervalRef.current = setInterval(captureAndRead, 4_000)

      // Auto-stop if user ends screen share
      stream.getVideoTracks()[0].addEventListener("ended", stopWatching)
    } catch {
      // User cancelled screen picker — ignore
    }
  }, [captureAndRead, stopWatching])

  const isLive = status === "connected" || status === "speaking"

  return (
    <div className="min-h-screen bg-[#1C1C1E] flex flex-col">
      {/* Top bar */}
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
              isLive
                ? "border-2 border-[#2AB4A6] shadow-[0_0_40px_rgba(42,180,166,0.25)]"
                : "border-2 border-gray-800"
            }`}
            style={{ aspectRatio: "16/9" }}
          >
            <video
              ref={videoRef}
              autoPlay
              playsInline
              onLoadedMetadata={() => videoRef.current?.play().catch(() => {})}
              className={`absolute inset-0 w-full h-full object-cover transition-opacity duration-700 ${isLive ? "opacity-100" : "opacity-0"}`}
            />

            {!isLive && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-5 bg-[#0D0D0F]">
                {selectedPresenter && status === "idle" ? (
                  <img
                    src={selectedPresenter.thumbnail_url}
                    alt={selectedPresenter.name}
                    className="w-32 h-32 rounded-full object-cover border-2 border-gray-700 opacity-40"
                  />
                ) : (
                  <div className={`w-28 h-28 rounded-full border-2 flex items-center justify-center ${
                    status === "connecting" ? "border-yellow-500/40 bg-yellow-500/5 animate-pulse"
                    : status === "error"   ? "border-red-500/40 bg-red-500/5"
                    : "border-gray-700 bg-gray-800/30"
                  }`}>
                    <span className="text-5xl">{status === "error" ? "⚠️" : "🎙️"}</span>
                  </div>
                )}
                <div className="text-center px-8">
                  {status === "error" && error ? (
                    <>
                      <p className="text-red-400 text-sm font-medium">Connection error</p>
                      <p className="text-gray-500 text-xs mt-1">{error}</p>
                    </>
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
                {[1, 2, 3, 4].map((i) => (
                  <div key={i} className="w-1 rounded-full bg-[#2AB4A6]"
                    style={{ height: `${8 + i * 4}px`, animation: `wavebar 0.6s ease-in-out ${i * 0.1}s infinite alternate` }}
                  />
                ))}
                <span className="text-[#2AB4A6] text-xs font-medium ml-1.5">Speaking</span>
              </div>
            )}

            {/* Current lot badge when watching */}
            {isWatching && watchedLot?.lotNumber && (
              <div className="absolute top-3 left-3 bg-black/70 backdrop-blur-sm rounded-lg px-3 py-1.5">
                <p className="text-white text-sm font-bold">Lot {watchedLot.lotNumber}</p>
                {watchedLot.askingBid && (
                  <p className="text-[#2AB4A6] text-xs">Asking {watchedLot.askingBid}</p>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Controls panel */}
        <div className="w-80 flex-shrink-0 border-l border-gray-800 bg-[#1C1C1E] flex flex-col p-5 gap-4 overflow-y-auto">

          {/* Presenter picker */}
          <div className="bg-[#2C2C2E] rounded-xl p-4 border border-gray-800">
            <h2 className="text-gray-400 text-xs font-semibold uppercase tracking-widest mb-3">Presenter</h2>
            {loadingPresenters ? (
              <p className="text-gray-600 text-xs text-center py-2">Loading…</p>
            ) : presenters.length === 0 ? (
              <p className="text-red-400 text-xs">Could not load presenters</p>
            ) : (
              <div className="grid grid-cols-3 gap-2">
                {presenters.map((p) => {
                  const pid = p.presenter_id ?? p.id ?? ""
                  return (
                    <button key={pid} onClick={() => handleSelectPresenter(p)} title={p.name}
                      className={`relative rounded-lg overflow-hidden aspect-square transition-all ${
                        selectedId === pid
                          ? "ring-2 ring-[#2AB4A6] ring-offset-1 ring-offset-[#2C2C2E] opacity-100"
                          : "ring-1 ring-gray-700 hover:ring-gray-500 opacity-50 hover:opacity-80"
                      }`}
                    >
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
                onClick={() => selectedPresenter && connect(selectedPresenter.image_url ?? selectedPresenter.thumbnail_url)}
                disabled={!selectedPresenter || loadingPresenters}
                className="w-full py-2.5 bg-[#2AB4A6] hover:bg-[#22a090] text-black font-semibold rounded-lg transition-colors text-sm disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Connect Avatar
              </button>
            ) : (
              <button onClick={disconnect}
                className="w-full py-2.5 bg-gray-700 hover:bg-gray-600 text-white font-semibold rounded-lg transition-colors text-sm"
              >
                {status === "connecting" ? "Cancel" : "Disconnect"}
              </button>
            )}
            {status === "connecting" && (
              <p className="text-yellow-400/70 text-xs text-center mt-2">Takes a few seconds…</p>
            )}
          </div>

          {/* Auto-Read */}
          <div className="bg-[#2C2C2E] rounded-xl p-4 border border-gray-800">
            <div className="flex items-center justify-between mb-1">
              <h2 className="text-gray-400 text-xs font-semibold uppercase tracking-widest">Auto-Read</h2>
              {isWatching && (
                <span className={`text-xs flex items-center gap-1 ${readingStatus === "reading" ? "text-yellow-400" : "text-[#2AB4A6]"}`}>
                  <span className={`w-1.5 h-1.5 rounded-full ${readingStatus === "reading" ? "bg-yellow-400 animate-pulse" : "bg-[#2AB4A6] animate-pulse"}`} />
                  {readingStatus === "reading" ? "Reading…" : "Watching"}
                </span>
              )}
            </div>
            <p className="text-gray-600 text-xs mb-3 leading-relaxed">
              Share the auction page — the avatar speaks each new lot automatically.
            </p>

            {!isWatching ? (
              <button
                onClick={startWatching}
                disabled={!isLive}
                className="w-full py-2.5 bg-fuchsia-600 hover:bg-fuchsia-500 text-white font-semibold rounded-lg transition-colors text-sm disabled:opacity-30 disabled:cursor-not-allowed"
              >
                🖥️  Share Screen
              </button>
            ) : (
              <button
                onClick={stopWatching}
                className="w-full py-2.5 bg-gray-700 hover:bg-gray-600 text-white font-semibold rounded-lg transition-colors text-sm"
              >
                Stop Watching
              </button>
            )}

            {!isLive && !isWatching && (
              <p className="text-gray-600 text-xs text-center mt-2">Connect avatar first</p>
            )}

            {watchedLot && (
              <div className="mt-3 bg-[#111113] rounded-lg p-3 border border-gray-700">
                <div className="flex justify-between text-xs">
                  <span className="text-gray-500">Lot</span>
                  <span className="text-white font-bold">{watchedLot.lotNumber ?? "—"}</span>
                </div>
                <div className="flex justify-between text-xs mt-1">
                  <span className="text-gray-500">Current bid</span>
                  <span className="text-white">{watchedLot.currentBid ?? "—"}</span>
                </div>
                <div className="flex justify-between text-xs mt-1">
                  <span className="text-gray-500">Asking bid</span>
                  <span className="text-[#2AB4A6] font-medium">{watchedLot.askingBid ?? "—"}</span>
                </div>
              </div>
            )}
          </div>

          {/* Manual Script */}
          <div className="bg-[#2C2C2E] rounded-xl p-4 border border-gray-800 flex flex-col">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-gray-400 text-xs font-semibold uppercase tracking-widest">Manual Script</h2>
              <span className={`text-xs ${script.length > 3000 ? "text-red-400" : "text-gray-600"}`}>{script.length}</span>
            </div>
            <textarea
              value={script}
              onChange={(e) => setScript(e.target.value)}
              placeholder="Or type a manual script and click Speak…"
              className="min-h-[100px] bg-[#111113] text-white text-sm rounded-lg p-3 border border-gray-700 focus:border-[#2AB4A6] focus:outline-none resize-none placeholder-gray-700 leading-relaxed"
              maxLength={5000}
            />
            <div className="mt-3 flex gap-2">
              <button
                onClick={speak}
                disabled={status !== "connected" || script.trim().length < 3}
                className="flex-1 py-2.5 bg-[#2AB4A6] hover:bg-[#22a090] text-black font-semibold rounded-lg transition-colors text-sm disabled:opacity-30 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              >
                {status === "speaking" ? (
                  <><span className="inline-block w-3 h-3 border-2 border-black border-t-transparent rounded-full animate-spin" />Speaking…</>
                ) : "▶ Speak"}
              </button>
              {script && (
                <button onClick={() => setScript("")} className="px-3 text-gray-600 hover:text-gray-400 text-xs transition-colors">
                  Clear
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      <style>{`
        @keyframes wavebar {
          from { transform: scaleY(0.6); }
          to   { transform: scaleY(1.4); }
        }
      `}</style>
    </div>
  )
}
