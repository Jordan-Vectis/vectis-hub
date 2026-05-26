'use client'

import { useEffect, useRef, useState, useCallback } from 'react'

// ── Types ────────────────────────────────────────────────────────────────────

type ConnState = 'idle' | 'connecting' | 'open' | 'error' | 'closed'

type ActionType =
  | 'bid'        // Press Bid button on Saleroom (internet bid)
  | 'room'       // Press Room button on Saleroom (room/BSCB bid from Bidpath)
  | 'fw'         // Press Fair Warning on Saleroom
  | 'fw_cancel'  // FW cancelled — no action needed
  | 'sell'       // Fill hammer price + Press Sell
  | 'next'       // Press Next Lot on Saleroom
  | 'info'       // Informational only (e.g. lot locked — no Saleroom button)
  | 'connect'
  | 'disconnect'
  | 'error'

interface ActionEntry {
  id:       number
  at:       string
  type:     ActionType
  headline: string
  detail:   string
}

interface LiveState {
  lotNumber:  string
  lotTitle:   string
  currentBid: number
  askingBid:  number
  fwActive:   boolean
  soldLots:   Set<string>   // lot keys we've already acted on for Sell
}

// ── Helpers ──────────────────────────────────────────────────────────────────

let _seq = 0
function nextId() { return ++_seq }

function fmt(n: number) {
  return '£' + n.toLocaleString('en-GB')
}

function ts() {
  return new Date().toLocaleTimeString('en-GB', {
    hour: '2-digit', minute: '2-digit', second: '2-digit'
  })
}

// ── Action colours ───────────────────────────────────────────────────────────

const ACTION_STYLE: Record<ActionType, { border: string; badge: string; badgeBg: string }> = {
  bid:        { border: 'border-blue-500',   badge: 'PRESS BID',        badgeBg: 'bg-blue-600' },
  room:       { border: 'border-rose-500',   badge: 'PRESS ROOM',       badgeBg: 'bg-rose-600' },
  same:       { border: 'border-yellow-400', badge: 'PRESS ROOM (SAME)',badgeBg: 'bg-yellow-600' },
  fw:         { border: 'border-orange-400', badge: 'PRESS FW',         badgeBg: 'bg-orange-500' },
  fw_cancel:  { border: 'border-slate-500',  badge: 'FW CANCELLED',     badgeBg: 'bg-slate-600' },
  sell:       { border: 'border-green-500',  badge: 'PRESS SELL',       badgeBg: 'bg-green-600' },
  next:       { border: 'border-purple-400', badge: 'PRESS NEXT LOT',   badgeBg: 'bg-purple-600' },
  info:       { border: 'border-slate-600',  badge: 'INFO',             badgeBg: 'bg-slate-700' },
  connect:    { border: 'border-emerald-500',badge: 'CONNECTED',        badgeBg: 'bg-emerald-600' },
  disconnect: { border: 'border-red-500',    badge: 'DISCONNECTED',     badgeBg: 'bg-red-700' },
  error:      { border: 'border-red-600',    badge: 'ERROR',            badgeBg: 'bg-red-800' },
}

const PLATFORM_LABEL: Record<string, string> = {
  BSCB:   'Room bid button',
  Online: 'Vectis online bidder',
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function AutoClerkLivePage() {
  const [auctionId, setAuctionId]   = useState('')
  const [connState, setConnState]   = useState<ConnState>('idle')
  const [actions, setActions]       = useState<ActionEntry[]>([])
  const [liveState, setLiveState]   = useState<LiveState>({
    lotNumber:  '—',
    lotTitle:   '—',
    currentBid: 0,
    askingBid:  0,
    fwActive:   false,
    soldLots:   new Set(),
  })
  const [rawLog, setRawLog]         = useState<string[]>([])
  const [showRaw, setShowRaw]       = useState(false)
  const [simButton, setSimButton]   = useState<'bid' | 'room' | 'same' | 'sell' | 'next' | 'fw' | null>(null)
  const [simAmount, setSimAmount]   = useState(0)

  const wsRef        = useRef<WebSocket | null>(null)
  const stateRef     = useRef<LiveState>({ lotNumber: '—', lotTitle: '—', currentBid: 0, askingBid: 0, fwActive: false, soldLots: new Set() })
  const reconnectRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const feedRef      = useRef<HTMLDivElement | null>(null)
  const simTimerRef  = useRef<ReturnType<typeof setTimeout> | null>(null)

  function triggerSim(btn: 'bid' | 'room' | 'same' | 'sell' | 'next' | 'fw', amount = 0) {
    if (simTimerRef.current) clearTimeout(simTimerRef.current)
    setSimButton(btn)
    setSimAmount(amount)
    simTimerRef.current = setTimeout(() => setSimButton(null), 2000)
  }

  // Keep stateRef in sync
  const updateLive = useCallback((patch: Partial<Omit<LiveState, 'soldLots'>>) => {
    stateRef.current = { ...stateRef.current, ...patch }
    setLiveState(prev => ({ ...prev, ...patch }))
  }, [])

  function addAction(type: ActionType, headline: string, detail: string) {
    const entry: ActionEntry = { id: nextId(), at: ts(), type, headline, detail }
    setActions(prev => [entry, ...prev].slice(0, 200))
  }

  function addRaw(raw: string) {
    setRawLog(prev => [raw, ...prev].slice(0, 300))
  }

  // ── WebSocket event handler ───────────────────────────────────────────────

  function handleMessage(raw: string) {
    addRaw(raw)

    let parsed: any
    try { parsed = JSON.parse(raw) } catch { return }

    const cmd = parsed.command || parsed.type || ''

    // ── Lot advance ───────────────────────────────────────────────────────
    if (cmd === 'activeLotChange') {
      const d      = parsed.content || parsed
      const lotNo  = d.lot_number ?? d.lotNumber ?? d.auction_lot_number ?? '?'
      const title  = d.lot_title  ?? d.title ?? ''
      const asking = Number(d.asking_price ?? d.asking ?? 0)

      updateLive({
        lotNumber:  String(lotNo),
        lotTitle:   title,
        currentBid: 0,
        askingBid:  asking,
        fwActive:   false,
      })

      triggerSim('next')
      addAction('next',
        `Press NEXT LOT on Saleroom — advancing to Lot ${lotNo}`,
        title ? `"${title}"` : ''
      )
      return
    }

    // ── Bid received ──────────────────────────────────────────────────────
    if (cmd === 'liveBidEvent') {
      const d        = parsed.content || parsed
      const amount   = Number(d.amount ?? 0)
      const asking   = Number(d.asking ?? 0)
      const platform = d.platform ?? ''
      const lotNo    = d.lot_number ?? d.lotNumber ?? stateRef.current.lotNumber

      updateLive({ currentBid: amount, ...(asking > 0 ? { askingBid: asking } : {}) })

      const isRoom    = platform === 'BSCB'
      const isSameAmt = amount > 0 && amount === stateRef.current.currentBid

      if (isRoom && isSameAmt) {
        triggerSim('same', amount)
        addAction('same',
          `Press ROOM on Saleroom — same amount ${fmt(amount)}`,
          `Drop bidder — room bid at Vectis at same price · Lot ${lotNo}`
        )
      } else if (isRoom) {
        triggerSim('room', amount)
        addAction('room',
          `Press ROOM on Saleroom — ${fmt(amount)}`,
          `Room bid at Vectis · Lot ${lotNo}`
        )
      } else {
        triggerSim('bid', amount)
        const platformLabel = PLATFORM_LABEL[platform] ?? platform
        addAction('bid',
          `Press BID on Saleroom — ${fmt(amount)}`,
          `Source: ${platformLabel} · Lot ${lotNo}`
        )
      }
      return
    }

    // ── Commission bid received ───────────────────────────────────────────
    if (cmd === 'liveCommissionBidEvent') {
      const d      = parsed.content || parsed
      const amount = Number(d.amount ?? 0)
      const lotNo  = d.lot_number ?? stateRef.current.lotNumber

      updateLive({ currentBid: amount })
      triggerSim('bid', amount)

      addAction('bid',
        `Press BID on Saleroom — ${fmt(amount)}`,
        `Source: Commission bid · Lot ${lotNo}`
      )
      return
    }

    // ── Fair warning ──────────────────────────────────────────────────────
    if (cmd === 'getFairWarningStatus') {
      const d  = parsed.content || parsed
      const fw = Boolean(d.fair_warning ?? d.fairWarning)

      if (fw && !stateRef.current.fwActive) {
        updateLive({ fwActive: true })
        triggerSim('fw')
        addAction('fw',
          'Press FAIR WARNING on Saleroom',
          `Current bid: ${stateRef.current.currentBid > 0 ? fmt(stateRef.current.currentBid) : 'none'} · Lot ${stateRef.current.lotNumber}`
        )
      } else if (!fw && stateRef.current.fwActive) {
        updateLive({ fwActive: false })
        addAction('fw_cancel',
          'Fair Warning cancelled — no action on Saleroom',
          'New bid came in on Bidpath after FW was called'
        )
      }
      return
    }

    // ── Lot sold ──────────────────────────────────────────────────────────
    if (cmd === 'lotInformationUpdate') {
      const d        = parsed.content || parsed
      const keyName  = d.key_name  ?? d.keyName  ?? ''
      const keyValue = d.key_value ?? d.keyValue

      if (keyName === 'Sold' && (keyValue === true || keyValue === 'true' || keyValue === 1)) {
        const hammerPrice = Number(d.hammer_price ?? d.hammerPrice ?? stateRef.current.currentBid)
        const lotKey      = `${stateRef.current.lotNumber}:${hammerPrice}`

        // Debounce — lotInformationUpdate fires twice per lot
        if (!stateRef.current.soldLots.has(lotKey)) {
          stateRef.current.soldLots.add(lotKey)
          setLiveState(prev => ({ ...prev, soldLots: new Set(stateRef.current.soldLots) }))
          triggerSim('sell', hammerPrice)
          addAction('sell',
            `Fill hammer ${fmt(hammerPrice)} → Press SELL on Saleroom`,
            `Lot ${stateRef.current.lotNumber} sold at ${fmt(hammerPrice)}`
          )
        }
      }
      return
    }

    // ── Lot lock ──────────────────────────────────────────────────────────
    if (cmd === 'activeLotLock') {
      const d      = parsed.content || parsed
      const status = d.status ?? d.lockStatus

      if (status === 1 || status === '1') {
        addAction('info',
          'Lot locked on Bidpath',
          'Sell + Next Lot sequence incoming — watch for the SELL and NEXT LOT prompts'
        )
      }
      return
    }

    // ── Asking price update ───────────────────────────────────────────────
    if (cmd === 'setLiveAskingPrice') {
      const d      = parsed.content || parsed
      const asking = Number(d.asking_bid ?? 0)
      const lotNo  = d.lot_number ?? stateRef.current.lotNumber

      if (asking > 0) updateLive({ askingBid: asking })
      // Informational only — no Saleroom button press needed
      return
    }

    // ── Sensor / network events ───────────────────────────────────────────
    if (cmd === 'sensorNetworkEvent') {
      const d = parsed.content || parsed
      if (d.action === 'pause') {
        addAction('info', 'Auction paused on Bidpath', 'No Saleroom action required')
      } else if (d.action === 'resume') {
        addAction('info', 'Auction resumed on Bidpath', 'Continue monitoring')
      } else if (d.action === 'bid_quicker') {
        addAction('info', 'Bid quicker signal received', 'No Saleroom action required')
      }
      return
    }

    // Non-sold lotInformationUpdate updates are ignored silently
    if (cmd === 'lotInformationUpdate') {
      return
    }
  }

  // ── Connect / disconnect ──────────────────────────────────────────────────

  const disconnect = useCallback(() => {
    if (reconnectRef.current) { clearTimeout(reconnectRef.current); reconnectRef.current = null }
    if (wsRef.current) {
      wsRef.current.onclose = null
      wsRef.current.close()
      wsRef.current = null
    }
    setConnState('closed')
  }, [])

  const connect = useCallback((id: string) => {
    if (!id.trim()) return
    disconnect()

    const url = `wss://www.vectis.co.uk/wss/${id.trim()}`
    setConnState('connecting')
    addAction('info', `Connecting to Bidpath — auction ${id.trim()}`, url)

    const ws = new WebSocket(url)
    wsRef.current = ws

    ws.onopen = () => {
      setConnState('open')
      addAction('connect', 'Connected to Bidpath live feed', 'Shadow mode — observing only, nothing will be pressed')
    }

    ws.onmessage = (e) => {
      handleMessage(e.data)
    }

    ws.onerror = () => {
      setConnState('error')
      addAction('error', 'WebSocket error', 'Check the auction ID and try again')
    }

    ws.onclose = (e) => {
      wsRef.current = null
      if (e.wasClean) {
        setConnState('closed')
        addAction('disconnect', 'Connection closed cleanly', '')
      } else {
        setConnState('error')
        addAction('disconnect', 'Connection dropped — reconnecting in 5s', `Code: ${e.code}`)
        reconnectRef.current = setTimeout(() => connect(id), 5000)
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [disconnect])

  // Cleanup on unmount
  useEffect(() => {
    return () => { disconnect() }
  }, [disconnect])

  // Auto-scroll feed to top (newest first)
  useEffect(() => {
    feedRef.current?.scrollTo({ top: 0, behavior: 'smooth' })
  }, [actions])

  // ── Render ────────────────────────────────────────────────────────────────

  const connColor = {
    idle:       'text-slate-400',
    connecting: 'text-yellow-400',
    open:       'text-emerald-400',
    error:      'text-red-400',
    closed:     'text-slate-400',
  }[connState]

  const connDot = {
    idle:       'bg-slate-500',
    connecting: 'bg-yellow-400 animate-pulse',
    open:       'bg-emerald-400',
    error:      'bg-red-500',
    closed:     'bg-slate-500',
  }[connState]

  const connLabel = {
    idle:       'Not connected',
    connecting: 'Connecting…',
    open:       'Live — shadow mode',
    error:      'Error / reconnecting',
    closed:     'Disconnected',
  }[connState]

  const [showInfo, setShowInfo] = useState(false)

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col">

      {/* ── Info modal ──────────────────────────────────────────────────── */}
      {showInfo && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={() => setShowInfo(false)}>
          <div className="bg-slate-900 border border-slate-700 rounded-xl max-w-lg w-full p-6 shadow-2xl" onClick={e => e.stopPropagation()}>
            <div className="flex items-start justify-between mb-4">
              <h2 className="text-base font-bold text-slate-100">How this works — Bidpath shadow</h2>
              <button onClick={() => setShowInfo(false)} className="text-slate-500 hover:text-slate-300 text-xl leading-none ml-4">✕</button>
            </div>
            <div className="space-y-4 text-sm text-slate-300 leading-relaxed">
              <div>
                <p className="font-semibold text-white mb-1">📡 Where does the data come from?</p>
                <p>This page connects directly to the <strong>Bidpath WebSocket</strong> (<code className="text-xs bg-slate-800 px-1 rounded">wss://www.vectis.co.uk/wss/{'{auctionId}'}</code>). Bidpath streams every live auction event — bids, lot changes, sell signals, fair warnings — over this connection in real time. No login needed; it's the same feed Bidpath uses internally.</p>
              </div>
              <div>
                <p className="font-semibold text-white mb-1">👁 What does "shadow mode" mean?</p>
                <p>This page <strong>only reads</strong> the feed — it never sends anything to Bidpath or Saleroom. It's a read-only observer. Nothing will be pressed on either platform.</p>
              </div>
              <div>
                <p className="font-semibold text-white mb-1">🔔 What events are shown?</p>
                <ul className="list-disc list-inside space-y-1 text-slate-400">
                  <li><strong className="text-blue-400">PRESS BID</strong> — a bid came in on Bidpath (room button or online bidder)</li>
                  <li><strong className="text-green-400">PRESS SELL</strong> — Bidpath marked the lot as sold</li>
                  <li><strong className="text-purple-400">PRESS NEXT LOT</strong> — Bidpath advanced to a new lot</li>
                  <li><strong className="text-orange-400">PRESS FW</strong> — fair warning was called on Bidpath</li>
                  <li><strong className="text-yellow-400">LOT LOCKED</strong> — lot is closing; sell + next incoming</li>
                </ul>
              </div>
              <div>
                <p className="font-semibold text-white mb-1">🔢 Where do I find the Auction ID?</p>
                <p>Open the Bidpath bidstream in a browser. The URL contains <code className="text-xs bg-slate-800 px-1 rounded">id=1386</code> — that number is the Auction ID.</p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Header ─────────────────────────────────────────────────────── */}
      <div className="border-b border-slate-800 px-6 py-4">
        <div className="flex items-center justify-between flex-wrap gap-4">
          <div className="flex items-center gap-3">
            <div>
              <h1 className="text-xl font-bold tracking-tight">Auto Clerk — Live Feed Test</h1>
              <p className="text-sm text-slate-400 mt-0.5">
                Shadow mode — reads real Bidpath feed, shows what would be pressed on Saleroom
              </p>
            </div>
            <button
              onClick={() => setShowInfo(true)}
              title="How does this work?"
              className="w-6 h-6 rounded-full border border-slate-600 text-slate-400 hover:text-white hover:border-slate-400 text-xs font-bold flex items-center justify-center transition-colors shrink-0"
            >i</button>
          </div>

          {/* Connection status */}
          <div className={`flex items-center gap-2 text-sm font-medium ${connColor}`}>
            <span className={`w-2.5 h-2.5 rounded-full ${connDot}`} />
            {connLabel}
          </div>
        </div>

        {/* Connect form */}
        <div className="mt-4 flex items-center gap-3 flex-wrap">
          <label className="text-sm text-slate-400 shrink-0">Bidpath Auction ID:</label>
          <input
            type="text"
            value={auctionId}
            onChange={e => setAuctionId(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && auctionId.trim()) connect(auctionId) }}
            placeholder="e.g. 1386"
            className="bg-slate-800 border border-slate-700 rounded px-3 py-1.5 text-sm w-40 focus:outline-none focus:border-blue-500"
          />
          {connState !== 'open' && connState !== 'connecting' ? (
            <button
              onClick={() => connect(auctionId)}
              disabled={!auctionId.trim()}
              className="bg-blue-600 hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed px-4 py-1.5 rounded text-sm font-semibold transition-colors"
            >
              Connect
            </button>
          ) : (
            <button
              onClick={disconnect}
              className="bg-slate-700 hover:bg-slate-600 px-4 py-1.5 rounded text-sm font-semibold transition-colors"
            >
              Disconnect
            </button>
          )}

          <span className="text-slate-600 text-xs ml-2">
            ID found in bidstream URL: …com_bidstream&amp;id=<strong className="text-slate-400">1386</strong>
          </span>
        </div>
      </div>

      <div className="flex flex-1 gap-0 overflow-hidden">

        {/* ── Left: State panel ───────────────────────────────────────── */}
        <div className="w-64 shrink-0 border-r border-slate-800 p-4 flex flex-col gap-4">
          <div>
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Current Lot</p>
            <p className="text-2xl font-bold">{liveState.lotNumber}</p>
            <p className="text-xs text-slate-400 mt-1 leading-snug line-clamp-3">{liveState.lotTitle || '—'}</p>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div className="bg-slate-900 rounded p-2">
              <p className="text-xs text-slate-500">Current bid</p>
              <p className="text-sm font-semibold text-blue-300">
                {liveState.currentBid > 0 ? fmt(liveState.currentBid) : '—'}
              </p>
            </div>
            <div className="bg-slate-900 rounded p-2">
              <p className="text-xs text-slate-500">Asking</p>
              <p className="text-sm font-semibold text-slate-300">
                {liveState.askingBid > 0 ? fmt(liveState.askingBid) : '—'}
              </p>
            </div>
          </div>

          <div className={`rounded p-2 text-center text-sm font-semibold transition-colors ${
            liveState.fwActive
              ? 'bg-orange-900/60 text-orange-300 border border-orange-600'
              : 'bg-slate-900 text-slate-500'
          }`}>
            {liveState.fwActive ? '⚠ Fair Warning active' : 'No fair warning'}
          </div>

          <div className="border-t border-slate-800 pt-3">
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Lots Sold</p>
            <p className="text-2xl font-bold">{liveState.soldLots.size}</p>
          </div>

          <div className="mt-auto">
            <button
              onClick={() => setShowRaw(v => !v)}
              className={`w-full text-xs py-1.5 rounded border transition-colors ${
                showRaw
                  ? 'border-slate-500 text-slate-300 bg-slate-800'
                  : 'border-slate-700 text-slate-500 hover:text-slate-300'
              }`}
            >
              {showRaw ? 'Hide' : 'Show'} raw WebSocket log
            </button>
          </div>
        </div>

        {/* ── Right: Sim panel + feed ──────────────────────────────────── */}
        <div className="flex-1 flex flex-col overflow-hidden">

          {/* Fake Saleroom clerk screen */}
          <div className="shrink-0 border-b border-slate-800 bg-slate-900/40 px-4 py-3">
            <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-widest mb-3 flex items-center gap-2">
              <span className="w-1.5 h-1.5 rounded-full bg-blue-400 shrink-0" />
              Simulated Saleroom — buttons that would be pressed
            </p>
            <div className="flex gap-3 items-center flex-wrap">
              {/* Lot info */}
              <div className="bg-slate-950 border border-slate-700 rounded-lg px-4 py-2 text-center min-w-[100px] shrink-0">
                <p className="text-[9px] text-slate-500 uppercase tracking-wide">Lot</p>
                <p className="text-2xl font-black tabular-nums">{liveState.lotNumber}</p>
                <div className="flex gap-3 justify-center mt-1">
                  <div>
                    <p className="text-[9px] text-slate-600">Bid</p>
                    <p className="text-xs font-bold text-blue-300">{liveState.currentBid > 0 ? fmt(liveState.currentBid) : '—'}</p>
                  </div>
                  <div>
                    <p className="text-[9px] text-slate-600">Ask</p>
                    <p className="text-xs font-bold text-slate-300">{liveState.askingBid > 0 ? fmt(liveState.askingBid) : '—'}</p>
                  </div>
                </div>
              </div>
              {/* Action buttons — only buttons that actually exist on Saleroom */}
              {([
                { key: 'bid',  label: `BID${simButton === 'bid'   && simAmount > 0 ? ' — ' + fmt(simAmount) : ''}`,       activeClass: 'bg-blue-500   ring-blue-400   shadow-blue-500/50'   },
                { key: 'room', label: `ROOM${simButton === 'room'  && simAmount > 0 ? ' — ' + fmt(simAmount) : ''}`,      activeClass: 'bg-rose-500   ring-rose-400   shadow-rose-500/50'   },
                { key: 'same', label: `ROOM (same${simButton === 'same' && simAmount > 0 ? ' ' + fmt(simAmount) : ''})`,  activeClass: 'bg-yellow-500 ring-yellow-400 shadow-yellow-500/50' },
                { key: 'sell', label: `SELL${simButton === 'sell'  && simAmount > 0 ? ' — ' + fmt(simAmount) : ''}`,      activeClass: 'bg-green-500  ring-green-400  shadow-green-500/50'  },
                { key: 'next', label: 'NEXT LOT',    activeClass: 'bg-purple-500 ring-purple-400 shadow-purple-500/50' },
                { key: 'fw',   label: 'FAIR WARNING',activeClass: 'bg-orange-500 ring-orange-400 shadow-orange-500/50' },
                { key: 'undo', label: 'UNDO',        activeClass: 'bg-amber-500  ring-amber-400  shadow-amber-500/50'  },
              ] as const).map(({ key, label, activeClass }) => (
                <div
                  key={key}
                  className={`px-4 py-2.5 rounded-lg font-bold text-sm transition-all duration-150 select-none ${
                    simButton === key
                      ? `${activeClass} text-white scale-105 ring-4 ring-offset-2 ring-offset-slate-950 shadow-lg`
                      : 'bg-slate-800 text-slate-500 border border-slate-700'
                  }`}
                >{label}</div>
              ))}
            </div>
          </div>

          {/* Action feed */}
          <div ref={feedRef} className="flex-1 overflow-y-auto p-4">
          {showRaw ? (
            <div className="font-mono text-xs text-slate-400 space-y-1">
              {rawLog.length === 0 && (
                <p className="text-slate-600">No messages yet.</p>
              )}
              {rawLog.map((r, i) => (
                <div key={i} className="bg-slate-900 rounded px-3 py-1.5 break-all">
                  {r.length > 400 ? r.slice(0, 400) + '…' : r}
                </div>
              ))}
            </div>
          ) : (
            <div className="space-y-2">
              {actions.length === 0 && (
                <div className="text-center text-slate-600 mt-20">
                  <p className="text-4xl mb-3">📡</p>
                  <p className="text-sm">Connect to a Bidpath auction to begin.</p>
                  <p className="text-xs mt-1 text-slate-700">Actions will appear here in real time — nothing will actually be pressed on Saleroom.</p>
                </div>
              )}

              {actions.map(a => {
                const style = ACTION_STYLE[a.type]
                return (
                  <div
                    key={a.id}
                    className={`flex items-start gap-3 bg-slate-900 border-l-4 ${style.border} rounded-r px-4 py-3`}
                  >
                    <span className={`${style.badgeBg} text-white text-[10px] font-bold px-2 py-0.5 rounded shrink-0 mt-0.5 uppercase tracking-wide`}>
                      {style.badge}
                    </span>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium leading-snug">{a.headline}</p>
                      {a.detail && (
                        <p className="text-xs text-slate-400 mt-0.5">{a.detail}</p>
                      )}
                    </div>
                    <span className="text-[10px] text-slate-600 shrink-0 mt-1 tabular-nums">{a.at}</span>
                  </div>
                )
              })}
            </div>
          )}
          </div>{/* end feed */}
        </div>{/* end right column */}
      </div>
    </div>
  )
}
