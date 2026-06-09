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
          Keeps Vectis (Bidpath) and Saleroom (GAP) in sync during a live auction. Test one scenario at a time below.
        </p>
      </div>

      {/* ═══════════ TESTING ═══════════ */}
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <span className="text-xl">🧪</span>
          <h2 className="text-lg font-bold text-gray-900 dark:text-white">Testing</h2>
        </div>
        <p className="text-sm text-gray-500 dark:text-gray-400 -mt-1">
          Three ways to run the auto-clerk. We&apos;re building and testing them one at a time.
        </p>

        {/* Scenario 1 — built */}
        <a href="/auto-clerk-fake-saleroom.html" target="_blank" rel="noopener noreferrer"
          className="block bg-gradient-to-r from-sky-900/40 to-cyan-900/40 hover:from-sky-800/40 hover:to-cyan-800/40 border border-sky-700/40 rounded-xl p-5 transition-all group">
          <div className="flex items-center gap-2 mb-1.5">
            <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-sky-500/20 text-sky-300">Scenario 1</span>
            <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-green-500/20 text-green-400">Ready to test</span>
          </div>
          <p className="font-bold text-white text-base">Clerk on Vectis → auto Saleroom</p>
          <p className="text-sm text-sky-200/90 mt-1 leading-relaxed">
            You clerk the live auction on Vectis (Bidpath) exactly as normal. A fake Saleroom screen
            connects to the same auction and automatically presses its own buttons — Bid, Sell, Next,
            Fair warn and Undo — to keep Saleroom in step with what you do on Vectis. Includes a
            &quot;+ Saleroom online bid&quot; button to simulate an independent saleroom.com bidder.
          </p>
          <p className="text-xs text-sky-400 mt-3 group-hover:underline">Open the fake Saleroom screen ↗</p>
        </a>

        {/* Scenario 2 — coming next */}
        <div className="block bg-gray-100 dark:bg-[#1C1C1E] border border-gray-200 dark:border-gray-800 rounded-xl p-5 opacity-70">
          <div className="flex items-center gap-2 mb-1.5">
            <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-400">Scenario 2</span>
            <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-gray-400/20 text-gray-400">Coming next</span>
          </div>
          <p className="font-bold text-gray-900 dark:text-white text-base">Clerk on Saleroom → auto Vectis</p>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1 leading-relaxed">
            The reverse of Scenario 1 — you clerk on Saleroom and a fake Vectis (Bidpath-style) screen
            presses its buttons for you. Built once Scenario 1 is signed off.
          </p>
        </div>

        {/* Scenario 3 — coming soon */}
        <div className="block bg-gray-100 dark:bg-[#1C1C1E] border border-gray-200 dark:border-gray-800 rounded-xl p-5 opacity-70">
          <div className="flex items-center gap-2 mb-1.5">
            <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-purple-500/20 text-purple-400">Scenario 3</span>
            <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-gray-400/20 text-gray-400">Coming soon</span>
          </div>
          <p className="font-bold text-gray-900 dark:text-white text-base">Fully automated (timers)</p>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1 leading-relaxed">
            No clerk on either side — both platforms run automatically off inactivity timers
            (15s with no bids → Fair Warning, then 20s → Sell). Built last.
          </p>
        </div>
      </div>

      {/* ═══════════ SHADOW VIEWS ═══════════ */}
      <div className="space-y-3 pt-2">
        <div className="flex items-center gap-2">
          <span className="text-xl">📡</span>
          <h2 className="text-lg font-bold text-gray-900 dark:text-white">Shadow views</h2>
        </div>
        <p className="text-sm text-gray-500 dark:text-gray-400 -mt-1">
          Read-only — show what you&apos;d need to press on the other platform, without pressing anything.
        </p>

        <a href="/tools/auto-clerk-combined"
          className="flex items-center gap-4 bg-gradient-to-r from-violet-900/60 to-purple-900/60 hover:from-violet-800/60 hover:to-purple-800/60 border border-violet-700/50 rounded-xl p-5 transition-all group">
          <span className="text-3xl">⚡</span>
          <div className="flex-1 min-w-0">
            <p className="font-bold text-white text-base">Combined Shadow View</p>
            <p className="text-sm text-violet-300 mt-0.5">Both feeds side by side — Bidpath→Saleroom on the left, Saleroom→Bidpath on the right</p>
          </div>
          <span className="text-violet-400 text-sm group-hover:translate-x-1 transition-transform">→</span>
        </a>

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
              <p className="text-xs text-amber-300 mt-0.5">Console script on Saleroom — see what to press on Bidpath</p>
            </div>
            <span className="text-amber-400 text-xs group-hover:translate-x-1 transition-transform">→</span>
          </a>
        </div>
      </div>

      {/* Logic reference */}
      <div className="bg-white dark:bg-[#1C1C1E] border border-gray-200 dark:border-gray-700 rounded-xl p-5 space-y-5">
        <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">Sync Logic Reference</p>

        {/* Buttons that exist on each platform */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">

          {/* Vectis (Bidpath) buttons */}
          <div className="bg-gray-50 dark:bg-black/30 rounded-lg p-3 border border-gray-200 dark:border-gray-700">
            <p className="font-semibold text-gray-800 dark:text-gray-200 text-sm mb-2">🖥 Vectis (Bidpath) buttons</p>
            <ul className="space-y-1.5 text-xs text-gray-600 dark:text-gray-400">
              <li><span className="inline-block px-1.5 py-0.5 rounded bg-blue-600 text-white text-[10px] font-bold align-middle mr-1.5">SALEROOM</span><strong className="text-gray-700 dark:text-gray-300">Saleroom</strong> — advances Vectis bid when Saleroom is higher (press until matched)</li>
              <li><span className="inline-block w-5 h-5 rounded bg-yellow-500 text-white font-black text-sm leading-5 text-center align-middle mr-1.5">!</span><strong className="text-gray-700 dark:text-gray-300">!</strong> — drops Vectis bidder, keeps amount the same → Saleroom wins</li>
              <li><span className="inline-block px-1.5 py-0.5 rounded bg-green-600 text-white text-[10px] font-bold align-middle mr-1.5">HAMMER</span><strong className="text-gray-700 dark:text-gray-300">Hammer</strong> — sells the lot (step 1 of sell)</li>
              <li><span className="inline-block px-1.5 py-0.5 rounded bg-purple-600 text-white text-[10px] font-bold align-middle mr-1.5">NEXT LOT</span><strong className="text-gray-700 dark:text-gray-300">Next Lot</strong> — advance to next lot (step 2 of sell)</li>
              <li><span className="inline-block px-1.5 py-0.5 rounded bg-orange-500 text-white text-[10px] font-bold align-middle mr-1.5">FW</span><strong className="text-gray-700 dark:text-gray-300">Fair Warning</strong> — pressed manually after 15s inactivity</li>
              <li><span className="inline-block px-1.5 py-0.5 rounded bg-amber-600 text-white text-[10px] font-bold align-middle mr-1.5">UNDO</span><strong className="text-gray-700 dark:text-gray-300">Undo</strong> — removes the last bid (manual mistakes only)</li>
            </ul>
          </div>

          {/* Saleroom buttons */}
          <div className="bg-gray-50 dark:bg-black/30 rounded-lg p-3 border border-gray-200 dark:border-gray-700">
            <p className="font-semibold text-gray-800 dark:text-gray-200 text-sm mb-2">📺 Saleroom buttons</p>
            <ul className="space-y-1.5 text-xs text-gray-600 dark:text-gray-400">
              <li><span className="inline-block px-1.5 py-0.5 rounded bg-blue-600 text-white text-[10px] font-bold align-middle mr-1.5">BID</span><strong className="text-gray-700 dark:text-gray-300">Bid</strong> — advances Saleroom bid when Vectis is higher (press until matched)</li>
              <li><span className="inline-block px-1.5 py-0.5 rounded bg-rose-600 text-white text-[10px] font-bold align-middle mr-1.5">ROOM</span><strong className="text-gray-700 dark:text-gray-300">Room</strong> — drops Saleroom bidder, keeps amount the same → Vectis wins</li>
              <li><span className="inline-block px-1.5 py-0.5 rounded bg-green-600 text-white text-[10px] font-bold align-middle mr-1.5">SELL</span><strong className="text-gray-700 dark:text-gray-300">Sell</strong> — sells the lot (step 1 of sell)</li>
              <li><span className="inline-block px-1.5 py-0.5 rounded bg-purple-600 text-white text-[10px] font-bold align-middle mr-1.5">NEXT</span><strong className="text-gray-700 dark:text-gray-300">Next</strong> — advance to next lot (step 2 of sell)</li>
              <li><span className="inline-block px-1.5 py-0.5 rounded bg-orange-500 text-white text-[10px] font-bold align-middle mr-1.5">FW</span><strong className="text-gray-700 dark:text-gray-300">Fair Warning</strong> — pressed manually after 15s inactivity</li>
              <li><span className="inline-block px-1.5 py-0.5 rounded bg-amber-600 text-white text-[10px] font-bold align-middle mr-1.5">UNDO</span><strong className="text-gray-700 dark:text-gray-300">Undo</strong> — removes the last bid (manual mistakes only)</li>
            </ul>
          </div>
        </div>

        {/* Core rules */}
        <div className="bg-blue-50 dark:bg-blue-950/30 rounded-lg p-4 border border-blue-200 dark:border-blue-900 space-y-3">
          <p className="font-semibold text-blue-900 dark:text-blue-200 text-sm">🔁 Core sync rules</p>

          <div className="text-xs text-blue-900 dark:text-blue-200 space-y-2">
            <div>
              <p className="font-semibold">1. Only Vectis online + Saleroom online bids are automatic</p>
              <p className="text-blue-700 dark:text-blue-300/80 mt-0.5">Only bids with platform <code className="bg-white/10 px-1 rounded">Online</code> (Vectis online bidder) and <code className="bg-white/10 px-1 rounded">Saleroom</code> (Saleroom online bidder) appear on the other platform on their own. Every other source — <strong>Room</strong>, <strong>Telephone</strong>, <strong>Invaluable</strong>, <strong>BSCB</strong>, etc. — needs the clerk to press <strong>BID</strong> on Saleroom to advance.</p>
            </div>

            <div>
              <p className="font-semibold">2. Lot start sync — catch the lower platform up</p>
              <p className="text-blue-700 dark:text-blue-300/80 mt-0.5">Pre-bids can mean platforms open at different amounts.</p>
              <ul className="list-disc list-inside text-blue-700 dark:text-blue-300/80 mt-1 ml-2">
                <li>If <strong>Vectis is higher</strong> → press <strong>BID</strong> on Saleroom repeatedly until matched</li>
                <li>If <strong>Saleroom is higher</strong> → press <strong>SALEROOM</strong> button on Vectis repeatedly until matched</li>
              </ul>
            </div>

            <div>
              <p className="font-semibold">3. Same-amount tie — drop one bidder, keep the price</p>
              <p className="text-blue-700 dark:text-blue-300/80 mt-0.5">Only one platform can win each lot, so when both have a bid at the same price we must consolidate.</p>
              <ul className="list-disc list-inside text-blue-700 dark:text-blue-300/80 mt-1 ml-2">
                <li><strong>Favour Vectis</strong> → press <strong>ROOM</strong> on Saleroom (drops Saleroom bidder)</li>
                <li><strong>Favour Saleroom</strong> → press <strong>!</strong> on Vectis (drops Vectis bidder)</li>
                <li><strong>Default tie-break at lot start = always favour Vectis</strong> → press ROOM on Saleroom</li>
                <li><strong>During live bidding</strong> — whoever bid first at the tied price keeps it (no transfer)</li>
              </ul>
            </div>

            <div>
              <p className="font-semibold">4. Fair Warning — after 15s of no new bids</p>
              <p className="text-blue-700 dark:text-blue-300/80 mt-0.5">Both platforms have a FW button. Pressed on <strong>both at the same time</strong> by the clerk.</p>
            </div>

            <div>
              <p className="font-semibold">5. Sell sequence — 20s after Fair Warning if still no bids</p>
              <p className="text-blue-700 dark:text-blue-300/80 mt-0.5">Both platforms need their sell buttons pressed simultaneously by the clerk.</p>
              <ul className="list-disc list-inside text-blue-700 dark:text-blue-300/80 mt-1 ml-2">
                <li><strong>Vectis:</strong> <strong>HAMMER</strong> → then <strong>NEXT LOT</strong></li>
                <li><strong>Saleroom:</strong> <strong>SELL</strong> → then <strong>NEXT</strong></li>
              </ul>
            </div>

            <div>
              <p className="font-semibold">6. Undo — manual mistakes only</p>
              <p className="text-blue-700 dark:text-blue-300/80 mt-0.5">Both platforms have an Undo button to remove the last bid if something goes wrong. No automatic detection.</p>
            </div>
          </div>
        </div>

        {/* Doesn't-exist warnings */}
        <div className="bg-rose-50 dark:bg-rose-950/30 rounded-lg p-3 border border-rose-200 dark:border-rose-900">
          <p className="font-semibold text-rose-900 dark:text-rose-200 text-sm mb-2">⚠ Things that don't exist (don't add these)</p>
          <ul className="space-y-0.5 text-xs text-rose-900 dark:text-rose-200">
            <li>❌ No "Lot Locked" button on Saleroom — lot lock is info only</li>
            <li>❌ Saleroom buttons do NOT have exclamation marks — they're plain labelled buttons</li>
            <li>❌ The only ! button is on Vectis, and it's only for dropping the Vectis bidder (favour Saleroom)</li>
            <li>❌ Hammer, Next Lot and Fair Warning on Vectis are labelled buttons — they are NOT !</li>
            <li>❌ No automatic same-amount detection in shadow pages — the tie-break logic only applies when both feeds are visible together</li>
            <li>❌ No automatic double-bid / undo detection — undo is a manual button only</li>
          </ul>
        </div>

        {/* Data sources */}
        <div>
          <p className="font-semibold text-gray-800 dark:text-gray-200 text-sm mb-2">🔌 Data sources</p>
          <ul className="space-y-1 text-xs text-gray-600 dark:text-gray-400">
            <li><strong>Vectis (Bidpath):</strong> direct WebSocket — <code className="bg-gray-100 dark:bg-gray-800 px-1 rounded">wss://www.vectis.co.uk/wss/{'{auctionId}'}</code></li>
            <li><strong>Saleroom (GAP):</strong> console-script MutationObserver watches <code className="bg-gray-100 dark:bg-gray-800 px-1 rounded">hammer-price</code>, <code className="bg-gray-100 dark:bg-gray-800 px-1 rounded">asking-price</code>, <code className="bg-gray-100 dark:bg-gray-800 px-1 rounded">lot-number</code>, <code className="bg-gray-100 dark:bg-gray-800 px-1 rounded">auction-message-content</code> — POSTs to <code className="bg-gray-100 dark:bg-gray-800 px-1 rounded">/api/gap-relay</code>, shadow page polls every 1s</li>
          </ul>
        </div>

        {/* Bidpath WebSocket field reference */}
        <div>
          <p className="font-semibold text-gray-800 dark:text-gray-200 text-sm mb-2">📨 Bidpath WebSocket field reference</p>
          <p className="text-xs text-gray-500 dark:text-gray-400 mb-1.5">All message data is in <code className="bg-gray-100 dark:bg-gray-800 px-1 rounded">parsed.content</code>, not <code className="bg-gray-100 dark:bg-gray-800 px-1 rounded">parsed.data</code></p>
          <ul className="space-y-0.5 text-xs text-gray-600 dark:text-gray-400 font-mono">
            <li><code className="text-gray-700 dark:text-gray-300">liveBidEvent</code>: content.amount, content.asking, content.platform (BSCB / Online / Saleroom), content.lot_id</li>
            <li><code className="text-gray-700 dark:text-gray-300">activeLotChange</code>: content.lot_number, content.lot_id</li>
            <li><code className="text-gray-700 dark:text-gray-300">lotInformationUpdate</code>: content.hammer_price (string), content.key_name, content.key_value</li>
            <li><code className="text-gray-700 dark:text-gray-300">getFairWarningStatus</code>: content.fair_warning (boolean)</li>
            <li><code className="text-gray-700 dark:text-gray-300">activeLotLock</code>: content.status (0 or 1)</li>
            <li><code className="text-gray-700 dark:text-gray-300">setLiveAskingPrice</code>: content.asking_bid, content.lot_number</li>
            <li><code className="text-gray-700 dark:text-gray-300">liveCommissionBidEvent</code>: content.amount</li>
          </ul>
        </div>

      </div>

      {/* ═══════════ LEGACY (old BroadcastChannel simulation) ═══════════ */}
      <details className="bg-white dark:bg-[#1C1C1E] border border-gray-200 dark:border-gray-700 rounded-xl overflow-hidden">
        <summary className="cursor-pointer px-5 py-3 text-sm font-semibold text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-[#222]">
          Legacy simulation (old approach) — kept for reference
        </summary>
        <div className="px-5 pb-5 pt-1 space-y-4 border-t border-gray-100 dark:border-gray-800">
          <p className="text-xs text-gray-500 dark:text-gray-500">
            The original simulation built on BroadcastChannel before the live WebSocket approach. Not used for the current testing scenarios.
          </p>

          {/* Dashboard shortcut */}
          <a href="/auto-clerk-dashboard.html" target="_blank" rel="noopener noreferrer"
            className="flex items-center gap-4 bg-gradient-to-r from-[#1d4ed8] to-[#1e3a8a] hover:from-[#2563eb] hover:to-[#1d4ed8] rounded-xl p-4 transition-all group">
            <span className="text-2xl">🖥</span>
            <div className="flex-1 min-w-0">
              <p className="font-bold text-white text-sm">Open Dashboard</p>
              <p className="text-xs text-blue-200 mt-0.5">All 4 panels in a single window — Bidpath, Saleroom, Controls &amp; Commentary</p>
            </div>
            <span className="text-blue-200 text-sm group-hover:translate-x-1 transition-transform">→</span>
          </a>

          {/* Open panels */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <a href="/auto-clerk-bidpath.html" target="_blank" rel="noopener noreferrer"
              className="block bg-[#0d1117] hover:bg-[#161b22] border border-[#30363d] rounded-xl p-4 transition-colors group">
              <p className="font-bold text-white text-sm">🖥 Bidpath Panel <span className="text-xs font-normal text-[#8b949e]">· Monitor 1</span></p>
              <p className="text-xs text-[#8b949e] mt-1 leading-relaxed">Simulated Bidpath clerk view. Generates fake bids and exposes state for Playwright.</p>
            </a>
            <a href="/auto-clerk-saleroom.html" target="_blank" rel="noopener noreferrer"
              className="block bg-gray-100 hover:bg-gray-200 dark:bg-[#1C1C1E] dark:hover:bg-[#2C2C2E] border border-gray-300 dark:border-gray-700 rounded-xl p-4 transition-colors group">
              <p className="font-bold text-gray-900 dark:text-white text-sm">📺 Saleroom Panel <span className="text-xs font-normal text-gray-500">· Monitor 2</span></p>
              <p className="text-xs text-gray-600 dark:text-gray-400 mt-1 leading-relaxed">Saleroom replica. Receives click commands from the coordinator.</p>
            </a>
            <a href="/auto-clerk-commentary.html" target="_blank" rel="noopener noreferrer"
              className="block bg-gray-100 hover:bg-gray-200 dark:bg-[#1C1C1E] dark:hover:bg-[#2C2C2E] border border-gray-300 dark:border-gray-700 rounded-xl p-4 transition-colors group">
              <p className="font-bold text-gray-900 dark:text-white text-sm">🎙 Commentary Feed</p>
              <p className="text-xs text-gray-600 dark:text-gray-400 mt-1 leading-relaxed">Explains every coordinator decision in plain English as it happens.</p>
            </a>
            <a href="/auto-clerk-controls.html" target="_blank" rel="noopener noreferrer"
              className="block bg-gray-100 hover:bg-gray-200 dark:bg-[#1C1C1E] dark:hover:bg-[#2C2C2E] border border-gray-300 dark:border-gray-700 rounded-xl p-4 transition-colors group">
              <p className="font-bold text-gray-900 dark:text-white text-sm">🕹 Manual Controls</p>
              <p className="text-xs text-gray-600 dark:text-gray-400 mt-1 leading-relaxed">Inject bids, force Fair Warning or Hammer, pause auto-bids for manual testing.</p>
            </a>
          </div>

          {/* Coordinator */}
          <div className="bg-gray-50 dark:bg-[#161616] border border-gray-200 dark:border-gray-700 rounded-xl p-4">
            <div className="flex items-center justify-between mb-3">
              <div>
                <p className="font-bold text-gray-900 dark:text-white text-sm">Coordinator</p>
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">Watches Bidpath and mirrors bids + timing to Saleroom (BroadcastChannel)</p>
              </div>
              <div className="flex items-center gap-3">
                {running && (
                  <span className={`text-xs px-2 py-1 rounded-full font-semibold ${connected ? 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-400' : 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/40 dark:text-yellow-400'}`}>
                    {connected ? '● Connected' : '● Waiting…'}
                  </span>
                )}
                {!running ? (
                  <button onClick={startCoordinator}
                    className="px-4 py-2 bg-green-600 hover:bg-green-500 text-white font-bold rounded-lg text-sm transition-colors">
                    ▶ Start Auto Clerk
                  </button>
                ) : (
                  <button onClick={stopCoordinator}
                    className="px-4 py-2 bg-red-600 hover:bg-red-500 text-white font-bold rounded-lg text-sm transition-colors">
                    ⏹ Stop
                  </button>
                )}
              </div>
            </div>
            <div className="bg-white dark:bg-black/30 rounded-lg border border-gray-200 dark:border-gray-700 p-3 h-40 overflow-y-auto font-mono text-xs">
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
        </div>
      </details>

    </div>
  )
}
