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
    const s = state.current

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

        // Mirror to Saleroom — tell it a bid arrived at this amount
        if (amount > s.saleroomBid) {
          ch.postMessage({ type: 'cmd_bid', amount })
          s.saleroomBid = amount
          addLog(`Bidpath bid £${amount} → cmd_bid to Saleroom`)
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

    // Tell Bidpath to start the simulation
    ch.postMessage({ type: 'cmd_start' })
    ch.postMessage({ type: 'coordinator_hello' })

    setRunning(true)
    addLog('Auto Clerk started — sending start to Bidpath…')
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
          Open both panels in separate windows — ideally on separate monitors. Then press Start below.
        </p>
      </div>

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
      <div className="bg-white dark:bg-[#1C1C1E] border border-gray-200 dark:border-gray-700 rounded-xl p-4">
        <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-3">Sync Logic</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs text-gray-600 dark:text-gray-400">
          <div>
            <p className="font-semibold text-gray-700 dark:text-gray-300 mb-1">Bid sync</p>
            <ul className="space-y-1">
              <li>Bidpath bid → <code className="bg-gray-100 dark:bg-gray-800 px-1 rounded">cmd_bid</code> to Saleroom (amount goes up)</li>
              <li>Saleroom bid → <code className="bg-gray-100 dark:bg-gray-800 px-1 rounded">Saleroom button</code> on Bidpath (amount goes up)</li>
              <li>Same amount, drop bidder → <code className="bg-gray-100 dark:bg-gray-800 px-1 rounded">!</code> on Bidpath / <code className="bg-gray-100 dark:bg-gray-800 px-1 rounded">Room</code> on Saleroom</li>
            </ul>
          </div>
          <div>
            <p className="font-semibold text-gray-700 dark:text-gray-300 mb-1">Timers</p>
            <ul className="space-y-1">
              <li>10s silence → Fair Warning on both</li>
              <li>10s after FW → Hammer on Bidpath</li>
              <li>Then Sell + Next on Saleroom</li>
            </ul>
          </div>
        </div>
        <div className="mt-3 pt-3 border-t border-gray-200 dark:border-gray-700">
          <p className="text-xs text-gray-500 dark:text-gray-400">
            <strong>Playwright targets — Bidpath:</strong>{' '}
            <code className="bg-gray-100 dark:bg-gray-800 px-1 rounded">#sim-state-badge[data-state]</code>{' '}
            <code className="bg-gray-100 dark:bg-gray-800 px-1 rounded">#current-bid[data-current-bid]</code>{' '}
            <code className="bg-gray-100 dark:bg-gray-800 px-1 rounded">#current-bid[data-last-bid-ms]</code>
          </p>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
            <strong>Playwright targets — Saleroom:</strong>{' '}
            <code className="bg-gray-100 dark:bg-gray-800 px-1 rounded">#sr-state[data-current-bid]</code>{' '}
            <code className="bg-gray-100 dark:bg-gray-800 px-1 rounded">#bFW</code>{' '}
            <code className="bg-gray-100 dark:bg-gray-800 px-1 rounded">#fH</code>{' '}
            <code className="bg-gray-100 dark:bg-gray-800 px-1 rounded">#btn-sell</code>{' '}
            <code className="bg-gray-100 dark:bg-gray-800 px-1 rounded">#btn-next</code>
          </p>
        </div>
      </div>

    </div>
  )
}
