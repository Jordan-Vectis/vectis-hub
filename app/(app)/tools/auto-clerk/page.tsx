"use client"

import { useState, useEffect, useRef, useCallback } from "react"

// ─── Fake auction lots ─────────────────────────────────────────────────────────
const FAKE_LOTS = [
  { number: "1",  title: "Corgi Toys 267 Batmobile — red interior, black body, original box",  start: 30  },
  { number: "2",  title: "Matchbox Models of Yesteryear Y-5 1927 Talbot Van — boxed",          start: 15  },
  { number: "3",  title: "Dinky Toys 521 Bedford Articulated Lorry — with original box",       start: 20  },
  { number: "4",  title: "Hornby Dublo Class 8F 2-8-0 Locomotive and tender — boxed",          start: 50  },
  { number: "5",  title: "Britains Farm Set — tractor, plough and figures",                    start: 8   },
  { number: "6",  title: "Corgi Toys 497 The Man From U.N.C.L.E. Car — boxed",                start: 40  },
  { number: "7",  title: "Scalextric Formula 1 Twin-Track Racing Set — C74",                   start: 60  },
  { number: "8",  title: "Airfix 1:72 Spitfire MkIa — sealed box, unbuilt",                   start: 5   },
  { number: "9",  title: "Dinky Toys 100 Lady Penelope's FAB 1 — pink, boxed",                start: 80  },
  { number: "10", title: "Triang Minic Push & Go Police Car — original key and box",           start: 25  },
]

function nextIncrement(price: number): number {
  if (price < 50)   return 5
  if (price < 200)  return 10
  if (price < 700)  return 20
  if (price < 1000) return 50
  if (price < 3000) return 100
  if (price < 7000) return 200
  return 500
}

function fmt(p: number) { return `£${p.toLocaleString("en-GB")}` }
function fmtTime(d: Date) {
  return d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" })
}

// ─── Types ─────────────────────────────────────────────────────────────────────
type ClerkState = "IDLE" | "BIDDING" | "FAIR_WARNING" | "SOLD" | "PASSED" | "DONE"

type BidEntry = {
  id:     string
  at:     Date
  type:   "open" | "bid" | "fair_warning" | "fw_reset" | "sold" | "passed" | "hammer_note"
  label:  string
  amount: number
}

type LotResult = {
  number:  string
  title:   string
  hammer:  number | null
  sold:    boolean
}

type Settings = {
  silenceSecs:  number
  fwHammerSecs: number
  resetOnBid:   boolean
  speedX:       number
}

const DEFAULT_SETTINGS: Settings = {
  silenceSecs:  8,
  fwHammerSecs: 5,
  resetOnBid:   true,
  speedX:       1,
}

// ─── Component ─────────────────────────────────────────────────────────────────
export default function AutoClerkPage() {
  const [tab, setTab]           = useState<"bidpath" | "saleroom">("bidpath")
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS)
  const [running, setRunning]   = useState(false)
  const [clerkState, setClerkState] = useState<ClerkState>("IDLE")
  const [lotIdx, setLotIdx]         = useState(0)
  const [currentBid, setCurrentBid] = useState(0)
  const [bids, setBids]             = useState<BidEntry[]>([])
  const [results, setResults]       = useState<LotResult[]>([])
  const [silenceMs, setSilenceMs]   = useState(0)
  const [fwElapsedMs, setFwElapsedMs] = useState(0)
  const [now, setNow]               = useState(() => new Date())

  // ── Refs (mutable, always current, no stale-closure issues) ──────────────────
  const stateRef       = useRef<ClerkState>("IDLE")
  const lotIdxRef      = useRef(0)
  const currentBidRef  = useRef(0)
  const lastBidAtRef   = useRef<Date | null>(null)
  const fwStartAtRef   = useRef<Date | null>(null)
  const settingsRef    = useRef<Settings>(DEFAULT_SETTINGS)
  const runningRef     = useRef(false)
  const bidsLeftRef    = useRef(0)
  const bidTimerRef    = useRef<ReturnType<typeof setTimeout> | null>(null)
  const advTimerRef    = useRef<ReturnType<typeof setTimeout> | null>(null)
  const bidsLogRef     = useRef<BidEntry[]>([])

  // Keep settingsRef in sync with state
  useEffect(() => { settingsRef.current = settings }, [settings])

  // ── Helpers ───────────────────────────────────────────────────────────────────
  const setRunningBoth = (v: boolean) => { runningRef.current = v; setRunning(v) }
  const setStateBoth   = (s: ClerkState) => { stateRef.current = s; setClerkState(s) }
  const setLotBoth     = (i: number)     => { lotIdxRef.current = i; setLotIdx(i) }
  const setBidBoth     = (b: number)     => { currentBidRef.current = b; setCurrentBid(b) }

  const addEntry = useCallback((entry: Omit<BidEntry, "id" | "at">) => {
    const row: BidEntry = { ...entry, id: Math.random().toString(36).slice(2), at: new Date() }
    bidsLogRef.current = [...bidsLogRef.current.slice(-200), row]
    setBids(b => [...b.slice(-200), row])
  }, [])

  // ── Clock tick (100ms) ────────────────────────────────────────────────────────
  useEffect(() => {
    const t = setInterval(() => {
      const n = new Date()
      setNow(n)
      if (!runningRef.current) return

      const s   = stateRef.current
      const cfg = settingsRef.current

      if (lastBidAtRef.current && (s === "BIDDING" || s === "FAIR_WARNING")) {
        const silence = (n.getTime() - lastBidAtRef.current.getTime()) * cfg.speedX
        setSilenceMs(silence)

        if (s === "BIDDING" && silence >= cfg.silenceSecs * 1000) {
          triggerFairWarning()
        }
      }

      if (s === "FAIR_WARNING" && fwStartAtRef.current) {
        const fwEl = (n.getTime() - fwStartAtRef.current.getTime()) * cfg.speedX
        setFwElapsedMs(fwEl)
        if (fwEl >= cfg.fwHammerSecs * 1000) {
          triggerHammer()
        }
      }
    }, 100)
    return () => clearInterval(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ── Auto-bid scheduler ────────────────────────────────────────────────────────
  const scheduleNextBid = useCallback(() => {
    if (bidTimerRef.current) clearTimeout(bidTimerRef.current)
    if (bidsLeftRef.current <= 0) return // this lot has no more simulated bids

    const delay = (1500 + Math.random() * 4000) / settingsRef.current.speedX
    bidTimerRef.current = setTimeout(() => {
      if (!runningRef.current) return
      const s   = stateRef.current
      const cfg = settingsRef.current

      // Only bid if we're in BIDDING, or in FAIR_WARNING with resetOnBid
      if (s !== "BIDDING" && !(s === "FAIR_WARNING" && cfg.resetOnBid)) return

      const newBid = currentBidRef.current + nextIncrement(currentBidRef.current)
      currentBidRef.current = newBid
      setCurrentBid(newBid)
      lastBidAtRef.current = new Date()
      setSilenceMs(0)

      if (s === "FAIR_WARNING") {
        // New bid resets fair warning back to BIDDING
        fwStartAtRef.current = null
        setFwElapsedMs(0)
        stateRef.current = "BIDDING"
        setClerkState("BIDDING")
        addEntry({ type: "fw_reset", label: "↩ Fair warning reset — new bid received", amount: newBid })
        addEntry({ type: "bid",      label: "BSC Online",                               amount: newBid })
      } else {
        addEntry({ type: "bid", label: "BSC Online", amount: newBid })
      }

      bidsLeftRef.current--
      scheduleNextBid()
    }, delay)
  }, [addEntry])

  // ── Fair warning ──────────────────────────────────────────────────────────────
  const triggerFairWarning = useCallback(() => {
    if (stateRef.current !== "BIDDING") return
    fwStartAtRef.current = new Date()
    setFwElapsedMs(0)
    stateRef.current = "FAIR_WARNING"
    setClerkState("FAIR_WARNING")
    addEntry({ type: "fair_warning", label: "⚖ Fair warning called", amount: currentBidRef.current })
  }, [addEntry])

  // ── Hammer ────────────────────────────────────────────────────────────────────
  const triggerHammer = useCallback(() => {
    if (stateRef.current !== "FAIR_WARNING") return
    const bid  = currentBidRef.current
    const lot  = FAKE_LOTS[lotIdxRef.current]
    const sold = bid > 0

    stateRef.current = sold ? "SOLD" : "PASSED"
    setClerkState(sold ? "SOLD" : "PASSED")
    addEntry({
      type:   sold ? "sold"  : "passed",
      label:  sold ? `🔨 Sold — ${fmt(bid)}` : "↩ Lot passed / no sale",
      amount: bid,
    })

    if (sold) {
      addEntry({ type: "hammer_note", label: `↳ Enter ${fmt(bid)} into Saleroom`, amount: bid })
    }

    setResults(r => [...r, { number: lot.number, title: lot.title, hammer: sold ? bid : null, sold }])

    // Advance to next lot after a short pause
    if (advTimerRef.current) clearTimeout(advTimerRef.current)
    advTimerRef.current = setTimeout(() => {
      if (!runningRef.current) return
      const next = lotIdxRef.current + 1
      if (next >= FAKE_LOTS.length) {
        stateRef.current = "DONE"
        setClerkState("DONE")
        runningRef.current = false
        setRunning(false)
      } else {
        startLot(next)
      }
    }, 3000 / settingsRef.current.speedX)
  }, [addEntry]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Start a lot ───────────────────────────────────────────────────────────────
  const startLot = useCallback((idx: number) => {
    const lot = FAKE_LOTS[idx]
    lotIdxRef.current     = idx
    currentBidRef.current = lot.start
    lastBidAtRef.current  = new Date()
    fwStartAtRef.current  = null
    bidsLeftRef.current   = 2 + Math.floor(Math.random() * 7) // 2–8 bids per lot
    stateRef.current      = "BIDDING"

    setLotBoth(idx)
    setBidBoth(lot.start)
    setSilenceMs(0)
    setFwElapsedMs(0)
    setClerkState("BIDDING")
    setBids([{
      id:     Math.random().toString(36).slice(2),
      at:     new Date(),
      type:   "open",
      label:  `Opening bid — ${fmt(lot.start)}`,
      amount: lot.start,
    }])

    scheduleNextBid()
  }, [scheduleNextBid])

  // ── Controls ──────────────────────────────────────────────────────────────────
  function handleStart() {
    if (running) return
    setResults([])
    setRunningBoth(true)
    startLot(0)
  }

  function handleStop() {
    if (bidTimerRef.current) clearTimeout(bidTimerRef.current)
    if (advTimerRef.current) clearTimeout(advTimerRef.current)
    setRunningBoth(false)
    setStateBoth("IDLE")
    setSilenceMs(0)
    setFwElapsedMs(0)
  }

  function handleSkip() {
    if (!running) return
    if (bidTimerRef.current) clearTimeout(bidTimerRef.current)
    if (advTimerRef.current) clearTimeout(advTimerRef.current)
    const next = lotIdxRef.current + 1
    if (next >= FAKE_LOTS.length) {
      setStateBoth("DONE")
      setRunningBoth(false)
    } else {
      startLot(next)
    }
  }

  function handleReset() {
    handleStop()
    setStateBoth("IDLE")
    setLotBoth(0)
    setBidBoth(0)
    setBids([])
    setResults([])
  }

  function handleFwNow() {
    if (clerkState === "BIDDING") triggerFairWarning()
  }

  function handleHammerNow() {
    if (clerkState === "FAIR_WARNING") triggerHammer()
  }

  // ── Derived display values ────────────────────────────────────────────────────
  const lot         = FAKE_LOTS[lotIdx] ?? FAKE_LOTS[0]
  const silencePct  = settings.silenceSecs > 0
    ? Math.min((silenceMs / 1000) / settings.silenceSecs * 100, 100) : 0
  const fwPct       = settings.fwHammerSecs > 0
    ? Math.min((fwElapsedMs / 1000) / settings.fwHammerSecs * 100, 100) : 0
  const silenceSec  = (silenceMs / 1000).toFixed(1)
  const fwSec       = (fwElapsedMs / 1000).toFixed(1)

  const stateColor: Record<ClerkState, string> = {
    IDLE:         "bg-gray-600 text-gray-100",
    BIDDING:      "bg-green-600 text-white",
    FAIR_WARNING: "bg-amber-500 text-black",
    SOLD:         "bg-blue-600 text-white",
    PASSED:       "bg-rose-700 text-white",
    DONE:         "bg-purple-700 text-white",
  }
  const stateLabel: Record<ClerkState, string> = {
    IDLE:         "Idle",
    BIDDING:      "Bidding",
    FAIR_WARNING: "Fair Warning",
    SOLD:         "Sold",
    PASSED:       "Passed",
    DONE:         "Auction Complete",
  }

  // ── Render ────────────────────────────────────────────────────────────────────
  return (
    <div className="p-4 max-w-6xl mx-auto space-y-4">

      {/* Page header */}
      <div>
        <h1 className="text-xl font-bold text-gray-900 dark:text-white">Auto Clerk — Simulation</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
          Test the auto-clerk logic in a safe sandbox before connecting to live systems.
        </p>
      </div>

      {/* ── Settings bar ── */}
      <div className="bg-white dark:bg-[#1C1C1E] border border-gray-300 dark:border-gray-700 rounded-xl p-4">
        <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-3">Settings</p>
        <div className="flex flex-wrap gap-6 items-center">

          <label className="flex items-center gap-2">
            <span className="text-sm text-gray-700 dark:text-gray-300 whitespace-nowrap">Silence before fair warning</span>
            <input
              type="number" min={1} max={120} step={1}
              value={settings.silenceSecs}
              onChange={e => setSettings(s => ({ ...s, silenceSecs: Number(e.target.value) }))}
              className="w-16 px-2 py-1 text-sm rounded-lg border border-gray-300 dark:border-gray-600
                         bg-gray-50 dark:bg-[#2C2C2E] text-gray-900 dark:text-white text-center"
            />
            <span className="text-sm text-gray-500">s</span>
          </label>

          <label className="flex items-center gap-2">
            <span className="text-sm text-gray-700 dark:text-gray-300 whitespace-nowrap">FW → hammer</span>
            <input
              type="number" min={1} max={60} step={1}
              value={settings.fwHammerSecs}
              onChange={e => setSettings(s => ({ ...s, fwHammerSecs: Number(e.target.value) }))}
              className="w-16 px-2 py-1 text-sm rounded-lg border border-gray-300 dark:border-gray-600
                         bg-gray-50 dark:bg-[#2C2C2E] text-gray-900 dark:text-white text-center"
            />
            <span className="text-sm text-gray-500">s</span>
          </label>

          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={settings.resetOnBid}
              onChange={e => setSettings(s => ({ ...s, resetOnBid: e.target.checked }))}
              className="w-4 h-4 rounded accent-[#2AB4A6]"
            />
            <span className="text-sm text-gray-700 dark:text-gray-300">Reset FW on new bid</span>
          </label>

          <div className="flex items-center gap-2">
            <span className="text-sm text-gray-700 dark:text-gray-300">Speed</span>
            {[1, 2, 5].map(x => (
              <button
                key={x}
                onClick={() => setSettings(s => ({ ...s, speedX: x }))}
                className={`px-3 py-1 text-sm rounded-lg border transition-colors ${
                  settings.speedX === x
                    ? "bg-[#2AB4A6] border-[#2AB4A6] text-white"
                    : "border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-[#2C2C2E]"
                }`}
              >
                {x}×
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* ── Controls ── */}
      <div className="flex items-center gap-3 flex-wrap">
        <button
          onClick={handleStart}
          disabled={running || clerkState === "DONE"}
          className="px-4 py-2 bg-green-600 hover:bg-green-500 disabled:opacity-40 text-white text-sm font-medium rounded-lg transition-colors"
        >
          ▶ Start Auction
        </button>
        <button
          onClick={handleSkip}
          disabled={!running}
          className="px-4 py-2 bg-gray-600 hover:bg-gray-500 disabled:opacity-40 text-white text-sm font-medium rounded-lg transition-colors"
        >
          ⏭ Skip Lot
        </button>
        <button
          onClick={handleStop}
          disabled={!running}
          className="px-4 py-2 bg-rose-700 hover:bg-rose-600 disabled:opacity-40 text-white text-sm font-medium rounded-lg transition-colors"
        >
          ⏹ Stop
        </button>
        <button
          onClick={handleReset}
          disabled={running}
          className="px-4 py-2 bg-gray-500 hover:bg-gray-400 disabled:opacity-40 text-white text-sm font-medium rounded-lg transition-colors"
        >
          ↺ Reset
        </button>

        <div className="flex-1" />

        {/* Status */}
        {clerkState !== "IDLE" && (
          <div className="flex items-center gap-3">
            <span className="text-sm text-gray-500 dark:text-gray-400">
              Lot {lotIdx + 1} of {FAKE_LOTS.length}
            </span>
            <span className={`px-3 py-1 rounded-full text-xs font-bold ${stateColor[clerkState]}`}>
              {stateLabel[clerkState]}
            </span>
          </div>
        )}
      </div>

      {/* ── Two-tab panel ── */}
      {clerkState !== "IDLE" && clerkState !== "DONE" && (
        <div className="bg-white dark:bg-[#1C1C1E] border border-gray-300 dark:border-gray-700 rounded-xl overflow-hidden">

          {/* Tab bar */}
          <div className="flex border-b border-gray-200 dark:border-gray-800">
            {(["bidpath", "saleroom"] as const).map(t => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`px-5 py-3 text-sm font-medium transition-colors border-b-2 ${
                  tab === t
                    ? "border-[#2AB4A6] text-[#2AB4A6] dark:text-[#2AB4A6]"
                    : "border-transparent text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"
                }`}
              >
                {t === "bidpath" ? "🖥 Bidpath View" : "📺 Saleroom View"}
              </button>
            ))}
          </div>

          {/* ── BIDPATH VIEW ─────────────────────────────────────────── */}
          {tab === "bidpath" && (
            <div className="flex gap-0 min-h-[480px]">

              {/* Left: lot info + current state */}
              <div className="flex-1 p-5 border-r border-gray-200 dark:border-gray-800 flex flex-col gap-4">

                {/* Lot header */}
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-xs font-mono font-bold text-gray-500 dark:text-gray-400 uppercase tracking-widest">
                      Lot {lot.number}
                    </span>
                    <span className={`px-2 py-0.5 rounded-full text-xs font-bold ${stateColor[clerkState]}`}>
                      {stateLabel[clerkState]}
                    </span>
                  </div>
                  <p className="text-base font-semibold text-gray-900 dark:text-white leading-snug">{lot.title}</p>
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">Opening: {fmt(lot.start)}</p>
                </div>

                {/* Current bid */}
                <div className={`rounded-xl p-4 text-center ${
                  clerkState === "FAIR_WARNING"
                    ? "bg-amber-50 dark:bg-amber-900/20 border-2 border-amber-400"
                    : clerkState === "SOLD"
                    ? "bg-blue-50 dark:bg-blue-900/20 border-2 border-blue-400"
                    : clerkState === "PASSED"
                    ? "bg-rose-50 dark:bg-rose-900/20 border-2 border-rose-400"
                    : "bg-gray-50 dark:bg-[#2C2C2E] border border-gray-200 dark:border-gray-700"
                }`}>
                  <p className="text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-1">
                    {clerkState === "SOLD" ? "Hammer Price" : clerkState === "PASSED" ? "Passed" : "Current Bid"}
                  </p>
                  <p className={`text-4xl font-black tracking-tight ${
                    clerkState === "FAIR_WARNING" ? "text-amber-600 dark:text-amber-400" :
                    clerkState === "SOLD"         ? "text-blue-600 dark:text-blue-400" :
                    clerkState === "PASSED"       ? "text-rose-600 dark:text-rose-400" :
                    "text-gray-900 dark:text-white"
                  }`}>
                    {currentBid > 0 ? fmt(currentBid) : "—"}
                  </p>
                  {clerkState === "BIDDING" && (
                    <p className="text-xs text-gray-400 mt-1">
                      Next ask: {fmt(currentBid + nextIncrement(currentBid))}
                    </p>
                  )}
                </div>

                {/* Timer bars */}
                {(clerkState === "BIDDING" || clerkState === "FAIR_WARNING") && (
                  <div className="space-y-3">
                    {clerkState === "BIDDING" && (
                      <div>
                        <div className="flex justify-between text-xs text-gray-500 dark:text-gray-400 mb-1">
                          <span>Silence</span>
                          <span>{silenceSec}s / {settings.silenceSecs}s</span>
                        </div>
                        <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2">
                          <div
                            className="h-2 rounded-full transition-all bg-amber-500"
                            style={{ width: `${silencePct}%` }}
                          />
                        </div>
                      </div>
                    )}
                    {clerkState === "FAIR_WARNING" && (
                      <div>
                        <div className="flex justify-between text-xs text-gray-500 dark:text-gray-400 mb-1">
                          <span className="font-semibold text-amber-600 dark:text-amber-400">⚖ Fair Warning</span>
                          <span>{fwSec}s / {settings.fwHammerSecs}s → auto-hammer</span>
                        </div>
                        <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2">
                          <div
                            className="h-2 rounded-full transition-all bg-red-500"
                            style={{ width: `${fwPct}%` }}
                          />
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* Manual override buttons */}
                <div className="flex gap-2 mt-auto pt-2">
                  <button
                    onClick={handleFwNow}
                    disabled={clerkState !== "BIDDING"}
                    className="flex-1 py-2 text-sm font-medium rounded-lg border border-amber-500
                               text-amber-600 dark:text-amber-400 hover:bg-amber-50 dark:hover:bg-amber-900/20
                               disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                  >
                    ⚖ Call Fair Warning
                  </button>
                  <button
                    onClick={handleHammerNow}
                    disabled={clerkState !== "FAIR_WARNING"}
                    className="flex-1 py-2 text-sm font-medium rounded-lg border border-blue-500
                               text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/20
                               disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                  >
                    🔨 Hammer Now
                  </button>
                </div>
              </div>

              {/* Right: bid log */}
              <div className="w-80 flex flex-col">
                <div className="px-4 py-3 border-b border-gray-200 dark:border-gray-800">
                  <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                    Bid Log
                  </p>
                </div>
                <div className="flex-1 overflow-y-auto p-2 space-y-1 font-mono text-xs">
                  {[...bids].reverse().map(b => (
                    <div
                      key={b.id}
                      className={`px-2 py-1.5 rounded-lg ${
                        b.type === "fair_warning" ? "bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-300 font-bold" :
                        b.type === "fw_reset"     ? "bg-purple-50 dark:bg-purple-900/20 text-purple-700 dark:text-purple-300" :
                        b.type === "sold"         ? "bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300 font-bold" :
                        b.type === "passed"       ? "bg-rose-50 dark:bg-rose-900/20 text-rose-700 dark:text-rose-300" :
                        b.type === "hammer_note"  ? "bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400 italic" :
                        b.type === "open"         ? "bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-300" :
                        "text-gray-700 dark:text-gray-300"
                      }`}
                    >
                      <span className="text-gray-400 mr-1">{fmtTime(b.at)}</span>
                      {b.type === "bid" && <span className="font-bold text-[#2AB4A6]">{fmt(b.amount)}</span>}
                      {" "}
                      <span>{b.label}</span>
                    </div>
                  ))}
                  {bids.length === 0 && (
                    <p className="text-gray-400 text-center py-4">No bids yet</p>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* ── SALEROOM VIEW ─────────────────────────────────────────── */}
          {tab === "saleroom" && (
            <div className="p-6 min-h-[480px] flex flex-col gap-6">

              {/* Top bar mimicking external saleroom interface */}
              <div className="flex items-center justify-between">
                <div className="text-xs font-mono text-gray-400 uppercase tracking-widest">
                  Vectis Auctions · Live Clerk Interface
                </div>
                <div className="flex items-center gap-2 text-xs font-mono text-gray-400">
                  <span className={`w-2 h-2 rounded-full ${running ? "bg-green-400 animate-pulse" : "bg-gray-400"}`} />
                  {running ? "LIVE" : "OFFLINE"}
                </div>
              </div>

              {/* Main lot display */}
              <div className="grid grid-cols-2 gap-6">

                {/* Lot info panel */}
                <div className="bg-gray-50 dark:bg-[#2C2C2E] rounded-xl p-5 border border-gray-200 dark:border-gray-700">
                  <p className="text-xs uppercase tracking-widest text-gray-500 mb-2">Current Lot</p>
                  <p className="text-4xl font-black text-gray-900 dark:text-white mb-3">{lot.number}</p>
                  <p className="text-sm text-gray-700 dark:text-gray-300 leading-snug">{lot.title}</p>
                  <div className="mt-4 pt-4 border-t border-gray-200 dark:border-gray-700 flex justify-between text-xs text-gray-500">
                    <span>Opening: {fmt(lot.start)}</span>
                    {lotIdx + 1 < FAKE_LOTS.length && (
                      <span>Next: Lot {FAKE_LOTS[lotIdx + 1].number}</span>
                    )}
                  </div>
                </div>

                {/* Bid / status panel */}
                <div className={`rounded-xl p-5 border-2 flex flex-col items-center justify-center gap-3 ${
                  clerkState === "FAIR_WARNING"
                    ? "bg-amber-50 dark:bg-amber-900/20 border-amber-400"
                    : clerkState === "SOLD"
                    ? "bg-blue-50 dark:bg-blue-900/20 border-blue-400"
                    : clerkState === "PASSED"
                    ? "bg-rose-50 dark:bg-rose-900/20 border-rose-400"
                    : "bg-gray-50 dark:bg-[#2C2C2E] border-gray-200 dark:border-gray-700"
                }`}>
                  <p className={`text-xs uppercase tracking-widest font-bold ${
                    clerkState === "FAIR_WARNING" ? "text-amber-600 dark:text-amber-400" :
                    clerkState === "SOLD"         ? "text-blue-600 dark:text-blue-400" :
                    clerkState === "PASSED"       ? "text-rose-600 dark:text-rose-400" :
                    "text-gray-500"
                  }`}>
                    {clerkState === "FAIR_WARNING" ? "⚖ FAIR WARNING" :
                     clerkState === "SOLD"         ? "🔨 SOLD" :
                     clerkState === "PASSED"       ? "PASSED / NO SALE" :
                     "ACCEPTING BIDS"}
                  </p>

                  <p className={`text-6xl font-black tracking-tight ${
                    clerkState === "FAIR_WARNING" ? "text-amber-600 dark:text-amber-400" :
                    clerkState === "SOLD"         ? "text-blue-700 dark:text-blue-400" :
                    clerkState === "PASSED"       ? "text-rose-600 dark:text-rose-400" :
                    "text-gray-900 dark:text-white"
                  }`}>
                    {currentBid > 0 ? fmt(currentBid) : "—"}
                  </p>

                  {clerkState === "BIDDING" && (
                    <p className="text-sm text-gray-500">
                      Next: {fmt(currentBid + nextIncrement(currentBid))}
                    </p>
                  )}

                  {clerkState === "FAIR_WARNING" && (
                    <div className="w-full mt-1">
                      <div className="w-full bg-amber-200 dark:bg-amber-800 rounded-full h-2">
                        <div
                          className="h-2 rounded-full bg-red-500 transition-all"
                          style={{ width: `${fwPct}%` }}
                        />
                      </div>
                      <p className="text-xs text-center text-amber-700 dark:text-amber-300 mt-1">
                        Hammering in {(settings.fwHammerSecs - fwElapsedMs / 1000).toFixed(1)}s
                      </p>
                    </div>
                  )}

                  {clerkState === "SOLD" && (
                    <div className="mt-2 bg-blue-100 dark:bg-blue-900/30 rounded-lg px-4 py-2 text-center">
                      <p className="text-xs text-blue-700 dark:text-blue-300 font-semibold">
                        ↳ Enter {fmt(currentBid)} into Saleroom system
                      </p>
                    </div>
                  )}
                </div>
              </div>

              {/* Saleroom action guidance */}
              <div className="bg-gray-50 dark:bg-[#2C2C2E] rounded-xl p-4 border border-gray-200 dark:border-gray-700">
                <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-2">
                  Clerk Action Required
                </p>
                {clerkState === "BIDDING" && (
                  <p className="text-sm text-gray-700 dark:text-gray-300">
                    Awaiting bids — auto-clerk will call fair warning after {settings.silenceSecs}s silence.
                  </p>
                )}
                {clerkState === "FAIR_WARNING" && (
                  <p className="text-sm text-amber-700 dark:text-amber-300 font-medium">
                    Fair warning in progress — click "Fair Warning" in Saleroom system if not already done.
                    Hammering automatically in {(settings.fwHammerSecs - fwElapsedMs / 1000).toFixed(1)}s.
                  </p>
                )}
                {clerkState === "SOLD" && (
                  <p className="text-sm text-blue-700 dark:text-blue-300 font-medium">
                    🔨 Lot sold at {fmt(currentBid)} — enter hammer price in Saleroom and advance to next lot.
                  </p>
                )}
                {clerkState === "PASSED" && (
                  <p className="text-sm text-rose-700 dark:text-rose-400 font-medium">
                    Lot passed without sale — mark as unsold in Saleroom and advance.
                  </p>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Done state ── */}
      {clerkState === "DONE" && (
        <div className="bg-purple-50 dark:bg-purple-900/20 border border-purple-300 dark:border-purple-700 rounded-xl p-6 text-center">
          <p className="text-lg font-bold text-purple-700 dark:text-purple-300 mb-1">Auction Complete</p>
          <p className="text-sm text-purple-600 dark:text-purple-400">
            All {FAKE_LOTS.length} lots processed.
          </p>
          <button
            onClick={handleReset}
            className="mt-3 px-4 py-2 bg-purple-600 hover:bg-purple-500 text-white text-sm font-medium rounded-lg transition-colors"
          >
            ↺ Run Again
          </button>
        </div>
      )}

      {/* ── Idle hint ── */}
      {clerkState === "IDLE" && (
        <div className="bg-gray-50 dark:bg-[#1C1C1E] border border-gray-200 dark:border-gray-700 rounded-xl p-6 text-center text-sm text-gray-500 dark:text-gray-400">
          Press <strong>Start Auction</strong> to begin the simulated sale.
          The auto-clerk will watch for bid silence, call fair warning, and hammer automatically.
        </div>
      )}

      {/* ── Results table ── */}
      {results.length > 0 && (
        <div className="bg-white dark:bg-[#1C1C1E] border border-gray-300 dark:border-gray-700 rounded-xl overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-200 dark:border-gray-800 flex items-center justify-between">
            <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
              Results
            </p>
            <div className="flex gap-4 text-xs text-gray-500">
              <span>Sold: <strong className="text-green-600 dark:text-green-400">{results.filter(r => r.sold).length}</strong></span>
              <span>Passed: <strong className="text-rose-600 dark:text-rose-400">{results.filter(r => !r.sold).length}</strong></span>
              <span>Total: <strong className="text-gray-700 dark:text-gray-300">
                {fmt(results.reduce((s, r) => s + (r.hammer ?? 0), 0))}
              </strong></span>
            </div>
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 dark:border-gray-800 text-xs text-gray-500 dark:text-gray-400">
                <th className="text-left px-4 py-2 font-medium">Lot</th>
                <th className="text-left px-4 py-2 font-medium">Title</th>
                <th className="text-right px-4 py-2 font-medium">Result</th>
              </tr>
            </thead>
            <tbody>
              {results.map(r => (
                <tr key={r.number} className="border-b border-gray-100 dark:border-gray-800 last:border-0">
                  <td className="px-4 py-2 font-mono font-bold text-gray-900 dark:text-white">{r.number}</td>
                  <td className="px-4 py-2 text-gray-700 dark:text-gray-300 truncate max-w-xs">{r.title}</td>
                  <td className="px-4 py-2 text-right">
                    {r.sold
                      ? <span className="font-semibold text-green-600 dark:text-green-400">{fmt(r.hammer!)}</span>
                      : <span className="text-rose-500">Passed</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
