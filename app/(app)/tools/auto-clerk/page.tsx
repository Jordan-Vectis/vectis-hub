'use client'

import { useEffect, useRef, useState, useCallback } from 'react'

const SILENCE_BEFORE_FW_MS  = 10_000  // 10s no bids → Fair Warning
const SILENCE_BEFORE_HAMMER_MS = 10_000  // 10s after FW → Hammer

interface LogEntry { time: string; msg: string }

export default function AutoClerkPage() {
  const [running, setRunning]   = useState(false)
  const [log, setLog]           = useState<LogEntry[]>([])
  const [connected, setConnected] = useState(false)

  const chRef    = useRef<BroadcastChannel | null>(null)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // Mutable state — updated inside the interval without re-renders
  const state = useRef({
    bidpathBid:  0,
    saleroomBid: 0,
    lastBidMs:   0,
    fwIssued:    false,
    fwIssuedAt:  0,
    simState:    'idle',
  })

  function addLog(msg: string) {
    const time = new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
    setLog(prev => [...prev.slice(-30), { time, msg }])
  }

  const stopCoordinator = useCallback(() => {
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null }
    if (chRef.current)    { chRef.current.close(); chRef.current = null }
    setRunning(false)
    setConnected(false)
    addLog('Auto Clerk stopped')
  }, [])

  const startCoordinator = useCallback(() => {
    const ch = new BroadcastChannel('vectis-auto-clerk')
    chRef.current = ch

    // Reset coordinator state
    const s = state.current
    s.bidpathBid  = 0
    s.saleroomBid = 0
    s.lastBidMs   = 0
    s.fwIssued    = false
    s.fwIssuedAt  = 0
    s.simState    = 'idle'

    ch.onmessage = (e) => {
      const msg = e.data

      // Bidpath connected
      if (msg.type === 'bidpath_hello') {
        setConnected(true)
        addLog('Bidpath connected')
        ch.postMessage({ type: 'coordinator_hello' })
      }

      // New lot started on Bidpath
      if (msg.type === 'bp_lot') {
        s.bidpathBid  = msg.start || 0
        s.saleroomBid = 0
        s.lastBidMs   = Date.now()
        s.fwIssued    = false
        addLog(`Lot ${msg.number} started — ${msg.title?.slice(0, 40)}`)
      }

      // Bid arrived on Bidpath
      if (msg.type === 'bp_bid') {
        const amount = msg.amount
        s.lastBidMs  = msg.ms || Date.now()
        s.fwIssued   = false
        s.bidpathBid = amount

        if (amount > s.saleroomBid) {
          ch.postMessage({ type: 'cmd_bid', amount, source: msg.source })
          s.saleroomBid = amount
          addLog(`Bidpath bid £${amount} (${msg.source}) → cmd_bid to Saleroom`)
        } else if (msg.source === 'Saleroom' && amount === s.saleroomBid && s.saleroomBid > 0) {
          // Clash — Saleroom.com bid at same level as existing — both platforms have online bidders
          ch.postMessage({ type: 'clash_warning', amount })
          addLog(`⚡ CLASH at £${amount} — both platforms have online bidders!`)
        }
      }

      // State change on Bidpath
      if (msg.type === 'bp_state') {
        s.simState   = msg.state
        s.bidpathBid = msg.bid || s.bidpathBid
      }

      // Saleroom confirmed a bid
      if (msg.type === 'sr_bid') {
        s.saleroomBid = msg.amount
      }

      // Saleroom had a room bid — need to mirror to Bidpath
      // (Bidpath operator would click ! next to Saleroom source to keep same amount)
      if (msg.type === 'sr_room_bid') {
        addLog(`Saleroom room bid £${msg.amount} — notify Bidpath operator`)
        // In the real system, Playwright would click ! on Bidpath here
        // For the simulation, just log it — the Bidpath sim drives bids independently
      }

      // Sim ended
      if (msg.type === 'sim_ended') {
        addLog('Simulation complete')
        stopCoordinator()
      }
    }

    // Silence detection loop — runs every 500ms
    timerRef.current = setInterval(() => {
      const s = state.current
      if (s.simState !== 'bidding' && s.simState !== 'fair_warning') return
      if (s.lastBidMs === 0) return

      const now      = Date.now()
      const silence  = now - s.lastBidMs

      // 10s silence → Fair Warning on both
      if (s.simState === 'bidding' && !s.fwIssued && silence >= SILENCE_BEFORE_FW_MS) {
        addLog(`10s silence → Fair Warning on both panels (bid: £${s.bidpathBid})`)
        ch.postMessage({ type: 'cmd_fw' })  // Saleroom clicks Fair Warn
        ch.postMessage({ type: 'cmd_fw' })  // Bidpath triggers FW (same channel, Bidpath handles it)
        s.fwIssued   = true
        s.fwIssuedAt = now
      }

      // 10s after FW → Hammer on Bidpath, then Sell + Next on Saleroom
      if (s.fwIssued && (now - s.fwIssuedAt) >= SILENCE_BEFORE_HAMMER_MS) {
        const amount = s.bidpathBid
        addLog(`FW timeout → Hammer on Bidpath | Sell £${amount} + Next on Saleroom`)
        ch.postMessage({ type: 'cmd_hammer' })            // Bidpath clicks Hammer
        setTimeout(() => {
          ch.postMessage({ type: 'cmd_sell', amount })    // Saleroom fills H + Sell
          setTimeout(() => {
            ch.postMessage({ type: 'cmd_next' })          // Saleroom clicks Next
          }, 600)
        }, 800)
        s.fwIssued    = false
        s.saleroomBid = 0
        s.lastBidMs   = now  // reset so we don't immediately FW again
      }
    }, 500)

    // Reset both panels to clean state first, then start after a short delay
    ch.postMessage({ type: 'cmd_reset' })
    ch.postMessage({ type: 'coordinator_hello' })
    addLog('Resetting both panels…')

    setTimeout(() => {
      ch.postMessage({ type: 'cmd_start' })
      addLog('Auto Clerk started — sending start to Bidpath…')
    }, 600)

    setRunning(true)
  }, [stopCoordinator])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current)
      if (chRef.current)    chRef.current.close()
    }
  }, [])

  return (
    <div className="p-6 max-w-3xl mx-auto space-y-6">

      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Auto Clerk</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
          Open the dashboard for all 4 panels in one window, or open them individually below.
        </p>
      </div>

      {/* Dashboard shortcut */}
      <a href="/auto-clerk-dashboard.html" target="_blank" rel="noopener noreferrer"
        className="flex items-center gap-4 bg-gradient-to-r from-[#1d4ed8] to-[#1e3a8a] hover:from-[#2563eb] hover:to-[#1d4ed8] rounded-xl p-5 transition-all group">
        <span className="text-3xl">🖥</span>
        <div className="flex-1 min-w-0">
          <p className="font-bold text-white text-base">Open Dashboard</p>
          <p className="text-sm text-blue-200 mt-0.5">All 4 panels in a single window — Bidpath, Saleroom, Controls &amp; Commentary</p>
        </div>
        <span className="text-blue-200 text-sm group-hover:translate-x-1 transition-transform">→</span>
      </a>

      {/* Open panels */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">

        <a href="/auto-clerk-bidpath.html" target="_blank" rel="noopener noreferrer"
          className="block bg-[#0d1117] hover:bg-[#161b22] border border-[#30363d] rounded-xl p-6 transition-colors group">
          <div className="flex items-center gap-3 mb-3">
            <span className="text-2xl">🖥</span>
            <div>
              <p className="font-bold text-white text-base">Bidpath Panel</p>
              <p className="text-xs text-[#8b949e]">Monitor 1</p>
            </div>
          </div>
          <p className="text-sm text-[#8b949e] leading-relaxed">
            Simulated Bidpath clerk view. Generates fake bids and exposes state for Playwright.
          </p>
          <p className="text-xs text-[#58a6ff] mt-4 group-hover:underline">Open in new tab →</p>
        </a>

        <a href="/auto-clerk-saleroom.html" target="_blank" rel="noopener noreferrer"
          className="block bg-gray-100 hover:bg-gray-200 dark:bg-[#1C1C1E] dark:hover:bg-[#2C2C2E] border border-gray-300 dark:border-gray-700 rounded-xl p-6 transition-colors group">
          <div className="flex items-center gap-3 mb-3">
            <span className="text-2xl">📺</span>
            <div>
              <p className="font-bold text-gray-900 dark:text-white text-base">Saleroom Panel</p>
              <p className="text-xs text-gray-500 dark:text-gray-400">Monitor 2</p>
            </div>
          </div>
          <p className="text-sm text-gray-600 dark:text-gray-400 leading-relaxed">
            Saleroom replica. Receives click commands from the coordinator — buttons are pressed automatically.
          </p>
          <p className="text-xs text-[#2AB4A6] mt-4 group-hover:underline">Open in new tab →</p>
        </a>

        <a href="/auto-clerk-commentary.html" target="_blank" rel="noopener noreferrer"
          className="block bg-gray-100 hover:bg-gray-200 dark:bg-[#1C1C1E] dark:hover:bg-[#2C2C2E] border border-gray-300 dark:border-gray-700 rounded-xl p-6 transition-colors group">
          <div className="flex items-center gap-3 mb-3">
            <span className="text-2xl">🎙</span>
            <div>
              <p className="font-bold text-gray-900 dark:text-white text-base">Commentary Feed</p>
              <p className="text-xs text-gray-500 dark:text-gray-400">Optional — any spare tab</p>
            </div>
          </div>
          <p className="text-sm text-gray-600 dark:text-gray-400 leading-relaxed">
            Explains every coordinator decision in plain English as it happens. Passive — no interaction needed.
          </p>
          <p className="text-xs text-[#a78bfa] mt-4 group-hover:underline">Open in new tab →</p>
        </a>

        <a href="/auto-clerk-controls.html" target="_blank" rel="noopener noreferrer"
          className="block bg-gray-100 hover:bg-gray-200 dark:bg-[#1C1C1E] dark:hover:bg-[#2C2C2E] border border-gray-300 dark:border-gray-700 rounded-xl p-6 transition-colors group">
          <div className="flex items-center gap-3 mb-3">
            <span className="text-2xl">🕹</span>
            <div>
              <p className="font-bold text-gray-900 dark:text-white text-base">Manual Controls</p>
              <p className="text-xs text-gray-500 dark:text-gray-400">Optional — any spare tab</p>
            </div>
          </div>
          <p className="text-sm text-gray-600 dark:text-gray-400 leading-relaxed">
            Inject bids as Vectis Auto or Saleroom.com, force Fair Warning or Hammer, pause auto-bids for manual testing.
          </p>
          <p className="text-xs text-[#f97316] mt-4 group-hover:underline">Open in new tab →</p>
        </a>

      </div>

      {/* Combined shadow view */}
      <a href="/tools/auto-clerk-combined"
        className="flex items-center gap-4 bg-gradient-to-r from-violet-900/60 to-purple-900/60 hover:from-violet-800/60 hover:to-purple-800/60 border border-violet-700/50 rounded-xl p-5 transition-all group">
        <span className="text-3xl">⚡</span>
        <div className="flex-1 min-w-0">
          <p className="font-bold text-white text-base">Combined Shadow View</p>
          <p className="text-sm text-violet-300 mt-0.5">Both feeds side by side — Bidpath→Saleroom on the left, Saleroom→Bidpath on the right</p>
        </div>
        <span className="text-violet-400 text-sm group-hover:translate-x-1 transition-transform">→</span>
      </a>

      {/* Individual shadow pages */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <a href="/tools/auto-clerk-live"
          className="flex items-center gap-3 bg-gradient-to-r from-emerald-900/40 to-teal-900/40 hover:from-emerald-800/40 hover:to-teal-800/40 border border-emerald-700/40 rounded-xl p-4 transition-all group">
          <span className="text-2xl">📡</span>
          <div className="flex-1 min-w-0">
            <p className="font-bold text-white text-sm">Bidpath → Saleroom</p>
            <p className="text-xs text-emerald-300 mt-0.5">Enter a Bidpath auction ID — see what to press on Saleroom</p>
          </div>
          <span className="text-emerald-400 text-xs group-hover:translate-x-1 transition-transform">→</span>
        </a>
        <a href="/tools/auto-clerk-saleroom"
          className="flex items-center gap-3 bg-gradient-to-r from-amber-900/40 to-orange-900/40 hover:from-amber-800/40 hover:to-orange-800/40 border border-amber-700/40 rounded-xl p-4 transition-all group">
          <span className="text-2xl">🏷</span>
          <div className="flex-1 min-w-0">
            <p className="font-bold text-white text-sm">Saleroom → Bidpath</p>
            <p className="text-xs text-amber-300 mt-0.5">Install bookmarklet on Saleroom — see what to press on Bidpath</p>
          </div>
          <span className="text-amber-400 text-xs group-hover:translate-x-1 transition-transform">→</span>
        </a>
      </div>

      {/* Coordinator */}
      <div className="bg-white dark:bg-[#1C1C1E] border border-gray-200 dark:border-gray-700 rounded-xl p-5">
        <div className="flex items-center justify-between mb-4">
          <div>
            <p className="font-bold text-gray-900 dark:text-white">Coordinator</p>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
              Watches Bidpath and mirrors bids + timing to Saleroom
            </p>
          </div>
          <div className="flex items-center gap-3">
            {running && (
              <span className={`text-xs px-2 py-1 rounded-full font-semibold ${connected ? 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-400' : 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/40 dark:text-yellow-400'}`}>
                {connected ? '● Connected' : '● Waiting…'}
              </span>
            )}
            {!running ? (
              <button
                onClick={startCoordinator}
                className="px-4 py-2 bg-green-600 hover:bg-green-500 text-white font-bold rounded-lg text-sm transition-colors"
              >
                ▶ Start Auto Clerk
              </button>
            ) : (
              <button
                onClick={stopCoordinator}
                className="px-4 py-2 bg-red-600 hover:bg-red-500 text-white font-bold rounded-lg text-sm transition-colors"
              >
                ⏹ Stop
              </button>
            )}
          </div>
        </div>

        {/* Activity log */}
        <div className="bg-gray-50 dark:bg-black/30 rounded-lg border border-gray-200 dark:border-gray-700 p-3 h-48 overflow-y-auto font-mono text-xs">
          {log.length === 0 ? (
            <p className="text-gray-400">Activity log will appear here…</p>
          ) : (
            log.map((entry, i) => (
              <div key={i} className="text-gray-700 dark:text-gray-300 leading-5">
                <span className="text-gray-400 mr-2">{entry.time}</span>{entry.msg}
              </div>
            ))
          )}
        </div>
      </div>

      {/* Logic reference */}
      <div className="bg-white dark:bg-[#1C1C1E] border border-gray-200 dark:border-gray-700 rounded-xl p-5 space-y-5">
        <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">Sync Logic Reference</p>

        {/* Buttons that exist on each platform */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">

          {/* Bidpath (Vectis) buttons */}
          <div className="bg-gray-50 dark:bg-black/30 rounded-lg p-3 border border-gray-200 dark:border-gray-700">
            <p className="font-semibold text-gray-800 dark:text-gray-200 text-sm mb-2">🖥 Bidpath (Vectis) buttons</p>
            <ul className="space-y-1.5 text-xs text-gray-600 dark:text-gray-400">
              <li><span className="inline-block w-5 h-5 rounded bg-blue-500 text-white font-black text-sm leading-5 text-center align-middle mr-1.5">!</span><strong className="text-gray-700 dark:text-gray-300">Bid</strong> — accepts an incoming bid</li>
              <li><span className="inline-block w-5 h-5 rounded bg-yellow-500 text-white font-black text-sm leading-5 text-center align-middle mr-1.5">!</span><strong className="text-gray-700 dark:text-gray-300">Same amount</strong> — drop bidder, keep price</li>
              <li><span className="inline-block w-5 h-5 rounded bg-green-500 text-white font-black text-sm leading-5 text-center align-middle mr-1.5">!</span><strong className="text-gray-700 dark:text-gray-300">Hammer</strong> — sells the lot</li>
              <li><span className="inline-block w-5 h-5 rounded bg-purple-500 text-white font-black text-sm leading-5 text-center align-middle mr-1.5">!</span><strong className="text-gray-700 dark:text-gray-300">Next Lot</strong> — advance to next lot</li>
              <li><span className="inline-block px-1.5 py-0.5 rounded bg-orange-500 text-white text-[10px] font-bold align-middle mr-1.5">FW</span><strong className="text-gray-700 dark:text-gray-300">Fair Warning</strong> — labelled button (not a !)</li>
              <li><span className="inline-block px-1.5 py-0.5 rounded bg-amber-600 text-white text-[10px] font-bold align-middle mr-1.5">UNDO</span><strong className="text-gray-700 dark:text-gray-300">Undo</strong> — removes the last bid</li>
            </ul>
          </div>

          {/* Saleroom buttons */}
          <div className="bg-gray-50 dark:bg-black/30 rounded-lg p-3 border border-gray-200 dark:border-gray-700">
            <p className="font-semibold text-gray-800 dark:text-gray-200 text-sm mb-2">📺 Saleroom buttons</p>
            <ul className="space-y-1.5 text-xs text-gray-600 dark:text-gray-400">
              <li><span className="inline-block px-1.5 py-0.5 rounded bg-blue-600 text-white text-[10px] font-bold align-middle mr-1.5">BID</span><strong className="text-gray-700 dark:text-gray-300">Bid</strong> — internet/online bid</li>
              <li><span className="inline-block px-1.5 py-0.5 rounded bg-rose-600 text-white text-[10px] font-bold align-middle mr-1.5">ROOM</span><strong className="text-gray-700 dark:text-gray-300">Room</strong> — room bid at Vectis</li>
              <li><span className="inline-block px-1.5 py-0.5 rounded bg-yellow-600 text-white text-[10px] font-bold align-middle mr-1.5">ROOM</span><strong className="text-gray-700 dark:text-gray-300">Room (same amount)</strong> — drop bidder</li>
              <li><span className="inline-block px-1.5 py-0.5 rounded bg-green-600 text-white text-[10px] font-bold align-middle mr-1.5">SELL</span><strong className="text-gray-700 dark:text-gray-300">Sell</strong> — fills hammer, sells the lot</li>
              <li><span className="inline-block px-1.5 py-0.5 rounded bg-purple-600 text-white text-[10px] font-bold align-middle mr-1.5">NEXT</span><strong className="text-gray-700 dark:text-gray-300">Next Lot</strong> — advance after sell</li>
              <li><span className="inline-block px-1.5 py-0.5 rounded bg-orange-500 text-white text-[10px] font-bold align-middle mr-1.5">FW</span><strong className="text-gray-700 dark:text-gray-300">Fair Warning</strong></li>
              <li><span className="inline-block px-1.5 py-0.5 rounded bg-amber-600 text-white text-[10px] font-bold align-middle mr-1.5">UNDO</span><strong className="text-gray-700 dark:text-gray-300">Undo</strong></li>
            </ul>
          </div>
        </div>

        {/* Event → Action mappings */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">

          {/* Bidpath → Saleroom */}
          <div>
            <p className="font-semibold text-gray-800 dark:text-gray-200 text-sm mb-2">📡 Bidpath event → press on Saleroom</p>
            <ul className="space-y-1 text-xs text-gray-600 dark:text-gray-400">
              <li>Online/internet bid → <strong>BID</strong></li>
              <li>BSCB (room) bid → <strong>ROOM</strong></li>
              <li>BSCB bid at same amount → <strong>ROOM (same)</strong></li>
              <li>Commission bid → <strong>BID</strong></li>
              <li>Lot sold → <strong>SELL</strong> (fill hammer) <em>then</em> <strong>NEXT LOT</strong></li>
              <li>Lot advance → <strong>NEXT LOT</strong></li>
              <li>Fair Warning called → <strong>FAIR WARNING</strong></li>
              <li>Lot lock → info only (no Saleroom button exists)</li>
              <li>Pause / resume → info only</li>
            </ul>
          </div>

          {/* Saleroom → Bidpath */}
          <div>
            <p className="font-semibold text-gray-800 dark:text-gray-200 text-sm mb-2">🏷 Saleroom event → press on Bidpath</p>
            <ul className="space-y-1 text-xs text-gray-600 dark:text-gray-400">
              <li>Internet bid → blue <strong>! (Bid)</strong></li>
              <li>Bid at same amount as current → yellow <strong>! (Same amount)</strong></li>
              <li>Lot sold → green <strong>! (Hammer)</strong> <em>then</em> purple <strong>! (Next Lot)</strong></li>
              <li>Lot offered → purple <strong>! (Next Lot)</strong> (confirm sync)</li>
              <li>Fair Warning called → <strong>Fair Warning</strong> button (not a !)</li>
              <li>Lot passed → info only</li>
              <li>Pause / resume → info only</li>
            </ul>
          </div>
        </div>

        {/* Sequence rules */}
        <div className="bg-blue-50 dark:bg-blue-950/30 rounded-lg p-3 border border-blue-200 dark:border-blue-900">
          <p className="font-semibold text-blue-900 dark:text-blue-200 text-sm mb-2">🔁 Sell sequences (two-step)</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs text-blue-900 dark:text-blue-200">
            <div>
              <p className="font-semibold mb-0.5">On Bidpath (Vectis)</p>
              <p>1. Press <strong>! Hammer</strong> (green) — sells</p>
              <p>2. Press <strong>! Next Lot</strong> (purple) — advances</p>
            </div>
            <div>
              <p className="font-semibold mb-0.5">On Saleroom</p>
              <p>1. Fill hammer price → Press <strong>SELL</strong></p>
              <p>2. Press <strong>NEXT LOT</strong></p>
            </div>
          </div>
        </div>

        {/* Doesn't-exist warnings */}
        <div className="bg-rose-50 dark:bg-rose-950/30 rounded-lg p-3 border border-rose-200 dark:border-rose-900">
          <p className="font-semibold text-rose-900 dark:text-rose-200 text-sm mb-2">⚠ Things that don't exist (don't add these)</p>
          <ul className="space-y-0.5 text-xs text-rose-900 dark:text-rose-200">
            <li>❌ No "Lot Locked" button on Saleroom — lot lock is info only</li>
            <li>❌ Saleroom buttons do NOT have exclamation marks — they're plain labelled buttons</li>
            <li>❌ Bidpath's "Fair Warning" is its own labelled button — it is NOT a !</li>
            <li>❌ No automatic double-bid detection — undo is a manual button only</li>
          </ul>
        </div>

        {/* Data sources */}
        <div>
          <p className="font-semibold text-gray-800 dark:text-gray-200 text-sm mb-2">🔌 Data sources</p>
          <ul className="space-y-1 text-xs text-gray-600 dark:text-gray-400">
            <li><strong>Bidpath:</strong> direct WebSocket — <code className="bg-gray-100 dark:bg-gray-800 px-1 rounded">wss://www.vectis.co.uk/wss/{'{auctionId}'}</code></li>
            <li><strong>Saleroom (GAP):</strong> console-script MutationObserver watches <code className="bg-gray-100 dark:bg-gray-800 px-1 rounded">hammer-price</code>, <code className="bg-gray-100 dark:bg-gray-800 px-1 rounded">asking-price</code>, <code className="bg-gray-100 dark:bg-gray-800 px-1 rounded">lot-number</code>, <code className="bg-gray-100 dark:bg-gray-800 px-1 rounded">auction-message-content</code> — POSTs to <code className="bg-gray-100 dark:bg-gray-800 px-1 rounded">/api/gap-relay</code>, shadow page polls every 1s</li>
          </ul>
        </div>

        {/* Bidpath WebSocket field reference */}
        <div>
          <p className="font-semibold text-gray-800 dark:text-gray-200 text-sm mb-2">📨 Bidpath WebSocket field reference</p>
          <p className="text-xs text-gray-500 dark:text-gray-400 mb-1.5">All message data is in <code className="bg-gray-100 dark:bg-gray-800 px-1 rounded">parsed.content</code>, not <code className="bg-gray-100 dark:bg-gray-800 px-1 rounded">parsed.data</code></p>
          <ul className="space-y-0.5 text-xs text-gray-600 dark:text-gray-400 font-mono">
            <li><code className="text-gray-700 dark:text-gray-300">liveBidEvent</code>: content.amount, content.asking, content.platform (BSCB/Online/Saleroom), content.lot_id</li>
            <li><code className="text-gray-700 dark:text-gray-300">activeLotChange</code>: content.lot_number, content.lot_id</li>
            <li><code className="text-gray-700 dark:text-gray-300">lotInformationUpdate</code>: content.hammer_price (string), content.key_name, content.key_value</li>
            <li><code className="text-gray-700 dark:text-gray-300">getFairWarningStatus</code>: content.fair_warning (boolean)</li>
            <li><code className="text-gray-700 dark:text-gray-300">activeLotLock</code>: content.status (0 or 1)</li>
            <li><code className="text-gray-700 dark:text-gray-300">setLiveAskingPrice</code>: content.asking_bid, content.lot_number</li>
            <li><code className="text-gray-700 dark:text-gray-300">liveCommissionBidEvent</code>: content.amount</li>
          </ul>
        </div>

      </div>

    </div>
  )
}
