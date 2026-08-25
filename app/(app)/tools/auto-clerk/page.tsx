'use client'

import { useEffect, useRef, useState, useCallback } from 'react'

// ⚠ LEGACY simulation timings only (sped up for testing). The real-world rule
// on the reference card is 15s of silence → Fair Warning, then 20s → Sell.
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

      {/* ═══════════ AUTOHOTKEY CLERK ═══════════ */}
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <span className="text-xl">🤖</span>
          <h2 className="text-lg font-bold text-gray-900 dark:text-white">AutoHotkey Clerk</h2>
        </div>
        <p className="text-sm text-gray-500 dark:text-gray-400 -mt-1">
          The real tool. It runs on the clerking PC — not in a browser — so it works on <strong>any</strong> clerking
          screen: the trainers now, the live Saleroom and Bidpath pages later. Nothing is installed into those pages
          and nothing is pasted into a console: it reads the bid figures off the screen and presses the buttons where
          you told it they are.
        </p>

        {/* Downloads */}
        <div className="bg-gradient-to-r from-slate-800/60 to-slate-900/60 border border-slate-600/50 rounded-xl p-5 space-y-3">
          <p className="font-bold text-white text-base">⬇ Download — put BOTH files in the same folder</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <a href="/auto-clerk/Auto%20Clerk.ahk" download="Auto Clerk.ahk"
              className="block bg-black/30 hover:bg-black/50 border border-slate-600 rounded-lg p-4 transition-colors group">
              <p className="font-mono font-bold text-sm text-emerald-300">Auto Clerk.ahk</p>
              <p className="text-xs text-gray-400 mt-1">The clerk itself. Double-click to open its window — calibrate, then Start.</p>
              <p className="text-xs text-emerald-400 mt-2 group-hover:underline">Download ↓</p>
            </a>
            <a href="/auto-clerk/Auto%20Clerk%20OCR.ps1" download="Auto Clerk OCR.ps1"
              className="block bg-black/30 hover:bg-black/50 border border-slate-600 rounded-lg p-4 transition-colors group">
              <p className="font-mono font-bold text-sm text-sky-300">Auto Clerk OCR.ps1</p>
              <p className="text-xs text-gray-400 mt-1">The screen reader it starts for itself. Never opened by hand — it just has to be there.</p>
              <p className="text-xs text-sky-400 mt-2 group-hover:underline">Download ↓</p>
            </a>
          </div>
          <ul className="text-xs text-gray-400 space-y-1 pt-1">
            <li>• Needs <strong className="text-gray-300">AutoHotkey v2</strong> on the PC (already installed on Jordan&apos;s). Nothing else — the screen reading uses Windows&apos; own text recognition, with no internet and nothing to install.</li>
            <li>• Keep the filenames exactly as they are: the clerk looks for its reader by name, in its own folder.</li>
            <li>• Chrome may ask you to keep the files — it says that about any script.</li>
            <li>• It writes <span className="font-mono text-gray-300">Auto Clerk.ini</span> (your calibration) and <span className="font-mono text-gray-300">Auto Clerk.log</span> (everything it did and why) alongside itself.</li>
          </ul>
        </div>

        {/* How it works */}
        <div className="bg-white dark:bg-[#1C1C1E] border border-gray-200 dark:border-gray-700 rounded-xl p-5 space-y-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">How it works</p>

          <div className="space-y-3 text-sm text-gray-700 dark:text-gray-300">
            <div>
              <p className="font-semibold text-gray-900 dark:text-white">1. Calibrate — tell it where things are</p>
              <p className="text-gray-600 dark:text-gray-400 mt-0.5">
                Pick the screen (Saleroom or Vectis), press <strong>🎯 Calibrate</strong>, and a banner walks you through
                each thing in turn. <strong>Buttons</strong>: hover over one and press <strong>F8</strong> (or middle-click,
                for laptops whose F-keys do something else). <strong>Figures</strong>: the screen dims and you
                <strong> drag a box</strong> round the number, like the snipping tool — crosshair guides, a live size
                readout, and it reads the box straight back so you know at once whether it can see the figure.
                What you draw is exactly what it reads, so include the whole area the figure sits in (it grows as the
                bidding climbs) and nothing else — another number inside the box can be read instead of the bid. Changing one
                thing later doesn&apos;t mean redoing the lot: pick it in <strong>Set just one</strong> and set that alone.
                Calibration is saved, so it only happens once per machine. The <strong>lot number</strong> box on each
                screen is worth marking where the lot number sits still — it&apos;s what stops the two platforms ever
                being worked as if they were on the same lot when they aren&apos;t — but it has its own tickbox, so leave
                it off where the number moves about.
              </p>
            </div>

            <div>
              <p className="font-semibold text-gray-900 dark:text-white">2. Test read — prove it can see</p>
              <p className="text-gray-600 dark:text-gray-400 mt-0.5">
                <strong>🔍 Test read</strong> shows every box you&apos;ve set: the exact enlarged picture the reader saw,
                what Windows made of it, and the bid figure the clerk would act on. If a picture shows the wrong spot,
                re-calibrate that one box. Do this on both screens before a run.
              </p>
            </div>

            <div>
              <p className="font-semibold text-gray-900 dark:text-white">3. Run — one screen, or both in step</p>
              <p className="text-gray-600 dark:text-gray-400 mt-0.5">
                Choose <strong>One screen</strong> (it clerks that screen on the timers) or <strong>BOTH screens</strong>
                (it also keeps the two platforms level with each other). Set the timers — 15 and 20 seconds is the real
                sale rule, 6 and 8 makes a practice run quick — then press Start and keep your hands off the mouse.
              </p>
            </div>
          </div>

          <div className="bg-blue-50 dark:bg-blue-950/30 rounded-lg p-4 border border-blue-200 dark:border-blue-900">
            <p className="font-semibold text-blue-900 dark:text-blue-200 text-sm mb-2">What it actually does</p>
            <ul className="text-xs text-blue-900 dark:text-blue-200 space-y-1.5">
              <li><strong>Reads the bid four times a second.</strong> It photographs your bid box, and Windows reads the number. A reading only counts once it has held steady, so a flicker never counts as a bid.</li>
              <li><strong>A rising figure is a bid</strong> — that resets the quiet clock. It never needs to know <em>who</em> bid to know the price.</li>
              <li><strong>Catches the other platform up to the exact amount</strong> (not one increment at a time, so it can&apos;t lag): on Saleroom by typing into the box next to A, on Vectis by setting the Asking bid and pressing the Saleroom button. An online bid that appears on both by itself gets no press at all.</li>
              <li><strong>Quiet for your Fair Warning time</strong> → Fair Warning on both. <strong>Quiet again</strong> → Hammer and Sell, then Next on both.</li>
              <li><strong>An undo on one screen</strong> pulls the other down with Undo until they match.</li>
              <li><strong>It can watch the lot number on each screen</strong> — a tickbox, needing a lot box on both. A lot moving on by itself is then recognised as exactly that rather than mistaken for an undo, and two screens on different lots stop it rather than having bids synced between them. Untick it where the lot number moves about the screen and can&apos;t be boxed; if the two boxes ever disagree twice it switches itself off and carries on rather than holding the run.</li>
              <li><strong>Two bidders landing on the same amount</strong> — it reads the top row of each bid list to tell a mirrored bid from a real tie, then follows the rule card: whoever bid first keeps it (Room on Saleroom, or the ! on Vectis).</li>
            </ul>
          </div>

          <div className="bg-green-50 dark:bg-green-950/30 rounded-lg p-4 border border-green-200 dark:border-green-900">
            <p className="font-semibold text-green-900 dark:text-green-200 text-sm mb-2">Safeguards — what stops it doing something daft</p>
            <ul className="text-xs text-green-900 dark:text-green-200 space-y-1.5">
              <li><strong>A last look, then a final watch, before every sale.</strong> It re-reads both screens, then watches the bid figures pixel-by-pixel — about a millisecond a look, against 200 for reading the number — and will not press until they have sat perfectly still. Anything that moves is read properly, and a higher figure stops the sale and starts the Fair Warning cycle again. A bid landing in the gap between reading and pressing is caught, which a snapshot alone could not do.</li>
              <li><strong>And a sold check after the hammer — the sale is reversible until Next.</strong> A bid the platform accepted but hadn&apos;t yet painted is unseeable at the moment of the press, so for a second and a half after hammering it checks what the lot actually shows before pressing Next. A higher figure (read twice, so one misread can&apos;t reverse a real sale) means a snipe arrived with the hammer: it presses <em>Re-Open Lot</em> on Vectis and the sale <em>Undo</em> on Saleroom, and bidding simply continues. Those two recovery buttons are part of calibration; until they&apos;re set it stops and tells you to reverse the sale by hand instead.</li>
              <li><strong>Being unable to read is never treated as &quot;the bids vanished&quot;.</strong> An unreadable screen holds the last figure; after 10 seconds it stops pressing anything, goes red and waits for you (F10 to resume).</li>
              <li><strong>Drops are slower to believe than rises</strong> — one bad frame can&apos;t undo a real bid.</li>
              <li><strong>Pence are understood, not multiplied.</strong> A screen showing £15.00 reads as fifteen pounds; a trailing pair of digits is treated as pence and never as part of the figure.</li>
              <li><strong>It checks each lot really moved on</strong> after Next, and says so in the log if it couldn&apos;t confirm it.</li>
              <li><strong>Every press is logged</strong> with its coordinates and the reason for it, so the whole run can be read back afterwards.</li>
            </ul>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="bg-gray-50 dark:bg-black/30 rounded-lg p-3 border border-gray-200 dark:border-gray-700">
              <p className="font-semibold text-gray-800 dark:text-gray-200 text-sm mb-2">⌨ While it runs</p>
              <ul className="space-y-1 text-xs text-gray-600 dark:text-gray-400">
                <li><strong>F9</strong> — start / stop</li>
                <li><strong>F10</strong> — pause / resume (resuming re-reads the screens from scratch)</li>
                <li><strong>Esc</strong> — stop, always</li>
                <li>Don&apos;t use the mouse — it&apos;s driving it.</li>
              </ul>
            </div>
            <div className="bg-amber-50 dark:bg-amber-950/20 rounded-lg p-3 border border-amber-200 dark:border-amber-900/60">
              <p className="font-semibold text-amber-900 dark:text-amber-200 text-sm mb-2">⚠ Before a real sale</p>
              <ul className="space-y-1 text-xs text-amber-900 dark:text-amber-200">
                <li>Switch <strong>Saleroom amount</strong> to &quot;type, then press BID&quot; — the trainer takes Enter, the real page uses the Bid button.</li>
                <li>Re-calibrate: the real pages sit differently from the trainers.</li>
                <li>The tie-break reads the words on the bid rows; those are confirmed on the trainers but not yet on the live pages — watch the log the first time.</li>
              </ul>
            </div>
          </div>
        </div>
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

        {/* Stress Tester — dual-platform bidder console (2026-08-24) */}
        <a href="/auto-clerk-bidders.html" target="_blank" rel="noopener noreferrer"
          className="block bg-gradient-to-r from-emerald-900/40 to-green-900/40 hover:from-emerald-800/40 hover:to-green-800/40 border border-emerald-700/40 rounded-xl p-5 transition-all group">
          <div className="flex items-center gap-2 mb-1.5">
            <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300">Stress Tester</span>
            <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-green-500/20 text-green-400">Ready</span>
          </div>
          <p className="font-bold text-white text-base">🤖 Bid on BOTH platforms at once</p>
          <p className="text-sm text-emerald-100/90 mt-1 leading-relaxed">
            Joins the two running practice sales as an ordinary bidder and fires the old manual-control
            patterns — a simultaneous clash, rapid ×5 on either side, an alternating ×10 storm — so the
            AutoHotkey Auto Clerk can be watched keeping the screens in step. Bids go in at each
            platform&apos;s next asking; room bids and the ! stay clerk-side.
          </p>
          <p className="text-xs text-emerald-400 mt-3 group-hover:underline">Open the Stress Tester ↗</p>
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
              <p className="font-semibold">2. Catch the lower platform up — use the exact amount, not increments</p>
              <p className="text-blue-700 dark:text-blue-300/80 mt-0.5">Pre-bids mean platforms can open at different amounts, and stepping one increment per bid always lags. Instead drive the lower platform straight to the exact figure:</p>
              <ul className="list-disc list-inside text-blue-700 dark:text-blue-300/80 mt-1 ml-2">
                <li>If <strong>Vectis is higher</strong> → on Saleroom, type the amount in the box next to <strong>A</strong> and press <strong>Bid</strong> to land on the exact figure</li>
                <li>If <strong>Saleroom is higher</strong> → bring Vectis up via the <strong>Saleroom</strong> button</li>
                <li>Auto-clerk always sets the driven platform to the <em>current absolute bid</em>, so a missed press self-corrects on the next bid. A verify-and-retry + watchdog + pre-sell reconcile guard against dropped clicks/lag, with a red banner if it ever gets stuck.</li>
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
              <p className="font-semibold">6. Undo — auto-detected in Scenario 1, manual everywhere else</p>
              <p className="text-blue-700 dark:text-blue-300/80 mt-0.5">Both platforms have an Undo button to remove the last bid.
                The <strong>Scenario 1 auto-clerk</strong> detects a retraction on Vectis (the bid amount drops below the last seen)
                and clicks Undo on Saleroom until the amounts match again. The <strong>shadow views</strong> do no undo detection,
                and the clerk&apos;s own mistakes are always a manual Undo press.</p>
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
            <li>❌ No automatic double-bid detection anywhere — and undo auto-detection exists ONLY in the Scenario 1 rig (Vectis bid amount drops); the shadow views never detect undos</li>
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
