'use client'

import { useEffect, useRef, useState } from 'react'
import type { GapEvent, GapEventType } from '@/app/api/gap-relay/route'

// ── Action mapping ────────────────────────────────────────────────────────────

type ActionType = 'bid' | 'sell' | 'next' | 'fw' | 'info' | 'connect' | 'disconnect'

interface Action {
  id:       number
  at:       string
  aType:    ActionType
  headline: string
  detail:   string
  raw:      string
}

const ACTION_STYLE: Record<ActionType, { border: string; badge: string; bg: string }> = {
  bid:        { border: 'border-blue-500',   badge: 'PRESS BID!',          bg: 'bg-blue-600' },
  sell:       { border: 'border-green-500',  badge: 'PRESS HAMMER!',       bg: 'bg-green-600' },
  next:       { border: 'border-purple-400', badge: 'PRESS NEXT LOT!',     bg: 'bg-purple-600' },
  fw:         { border: 'border-orange-400', badge: 'PRESS FAIR WARNING!', bg: 'bg-orange-500' },
  info:       { border: 'border-slate-600',  badge: 'INFO',                bg: 'bg-slate-700' },
  connect:    { border: 'border-emerald-500',badge: 'RELAY ACTIVE',        bg: 'bg-emerald-600' },
  disconnect: { border: 'border-red-500',    badge: 'NO SIGNAL',           bg: 'bg-red-700' },
}

function fmt(n: number) { return '£' + n.toLocaleString('en-GB') }
function ts()           { return new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) }

function mapEvent(e: GapEvent): Action | null {
  const base = { id: e.id, at: new Date(e.at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' }), raw: e.message }

  switch (e.type) {
    case 'bid_internet':
      return { ...base, aType: 'bid',
        headline: `Press BID! on Bidpath — ${fmt(e.hammer)}`,
        detail:   `Saleroom.com online bidder · Lot ${e.lot} · Asking ${fmt(e.asking)}` }

    case 'bid_room':
      return { ...base, aType: 'bid',
        headline: `Press BID! on Bidpath — ${fmt(e.hammer)}`,
        detail:   `Room/phone bid via Saleroom · Lot ${e.lot} · Asking ${fmt(e.asking)}` }

    case 'lot_offered':
      return { ...base, aType: 'next',
        headline: `Press NEXT LOT! on Bidpath — Lot ${e.lot} now live on Saleroom`,
        detail:   'Confirm Bidpath is on the same lot' }

    case 'lot_sold':
      return { ...base, aType: 'sell',
        headline: `Press HAMMER! on Bidpath — ${e.hammer > 0 ? fmt(e.hammer) : 'check Saleroom'}`,
        detail:   `Lot ${e.lot} · Then press NEXT LOT! to advance` }

    case 'fair_warning':
      return { ...base, aType: 'fw',
        headline: 'Press FAIR WARNING! on Bidpath',
        detail:   'Fair Warning called on Saleroom — press the button on Bidpath too' }

    case 'lot_passed':
      return { ...base, aType: 'info',
        headline: `Lot ${e.lot} passed on Saleroom`,
        detail:   'Mark lot as passed on Bidpath if not already' }

    case 'auction_paused':
      return { ...base, aType: 'info', headline: 'Auction paused on Saleroom', detail: '' }

    case 'auction_resumed':
      return { ...base, aType: 'info', headline: 'Auction resumed on Saleroom', detail: '' }

    default:
      return null
  }
}

// ── Relay endpoint options ────────────────────────────────────────────────────

const RELAY_PRESETS = [
  { label: 'Production', url: 'https://vectis-crm-production.up.railway.app/api/gap-relay' },
  { label: 'Staging',    url: 'https://vectis-staging.up.railway.app/api/gap-relay' },
]

function defaultRelayUrl() {
  if (typeof window === 'undefined') return RELAY_PRESETS[0].url
  return window.location.hostname.includes('staging')
    ? RELAY_PRESETS[1].url
    : RELAY_PRESETS[0].url
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function AutoClerkSaleroomPage() {
  const [actions, setActions]       = useState<Action[]>([])
  const [relayUrl, setRelayUrl]     = useState(defaultRelayUrl)
  const [lastSeen, setLastSeen]     = useState(0)
  const [active, setActive]         = useState(false)
  const [lastEventAt, setLastEventAt] = useState<number | null>(null)
  const [lotState, setLotState]     = useState({ lot: '—', hammer: 0, asking: 0, message: '—' })

  const [simButton, setSimButton]   = useState<'bid' | 'sell' | 'next' | 'fw' | null>(null)
  const [simAmount, setSimAmount]   = useState(0)

  const pollRef    = useRef<ReturnType<typeof setInterval> | null>(null)
  const feedRef    = useRef<HTMLDivElement | null>(null)
  const cursorRef  = useRef(0)
  const simTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  function triggerSim(btn: 'bid' | 'sell' | 'next' | 'fw', amount = 0) {
    if (simTimerRef.current) clearTimeout(simTimerRef.current)
    setSimButton(btn)
    setSimAmount(amount)
    simTimerRef.current = setTimeout(() => setSimButton(null), 2000)
  }

  function triggerSimSequence(btn1: 'bid' | 'sell' | 'next' | 'fw', amount1: number, btn2: 'bid' | 'sell' | 'next' | 'fw') {
    triggerSim(btn1, amount1)
    // Show the follow-up button after the first clears
    const t = setTimeout(() => triggerSim(btn2), 2200)
    simTimerRef.current = t
  }

  function addAction(a: Action) {
    setActions(prev => [a, ...prev].slice(0, 200))
  }

  // ── Polling ────────────────────────────────────────────────────────────────

  function startPolling() {
    if (pollRef.current) clearInterval(pollRef.current)
    setActive(true)
    cursorRef.current = 0
    setLastSeen(0)

    addAction({
      id: -Date.now(), at: ts(), aType: 'connect',
      headline: 'Polling relay — waiting for Saleroom events',
      detail:   relayUrl, raw: ''
    })

    pollRef.current = setInterval(async () => {
      try {
        const res = await fetch(`${relayUrl}?since=${cursorRef.current}`)
        if (!res.ok) return
        const data = await res.json()

        if (data.events && data.events.length > 0) {
          setLastEventAt(Date.now())
          cursorRef.current = data.cursor

          // Update live state from most recent event
          const latest = data.events[data.events.length - 1]
          setLotState({
            lot:     latest.lot     || '—',
            hammer:  latest.hammer  || 0,
            asking:  latest.asking  || 0,
            message: latest.message || '—',
          })

          // Trigger sim from most recent actionable event
          const lastActionable = [...data.events].reverse().find(
            (e: any) => ['bid_internet','bid_room','lot_sold','lot_offered','fair_warning'].includes(e.type)
          )
          if (lastActionable) {
            if (lastActionable.type === 'bid_internet' || lastActionable.type === 'bid_room') {
              triggerSim('bid', lastActionable.hammer)
            } else if (lastActionable.type === 'lot_sold') {
              // Hammer! then Next Lot! sequence
              triggerSimSequence('sell', lastActionable.hammer, 'next')
            } else if (lastActionable.type === 'lot_offered') {
              triggerSim('next')
            } else if (lastActionable.type === 'fair_warning') {
              triggerSim('fw')
            }
          }

          // Map to actions (newest last → displayed newest first)
          const newActions = data.events
            .map(mapEvent)
            .filter(Boolean) as Action[]

          newActions.reverse().forEach(addAction)
        }
      } catch { /* ignore network blips */ }
    }, 1000)
  }

  function stopPolling() {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null }
    setActive(false)
    addAction({
      id: -Date.now(), at: ts(), aType: 'disconnect',
      headline: 'Polling stopped', detail: '', raw: ''
    })
  }

  useEffect(() => { return () => { if (pollRef.current) clearInterval(pollRef.current) } }, [])

  // ── Stale indicator ────────────────────────────────────────────────────────
  const [stale, setStale] = useState(false)
  useEffect(() => {
    const t = setInterval(() => {
      setStale(active && lastEventAt !== null && Date.now() - lastEventAt > 30_000)
    }, 5000)
    return () => clearInterval(t)
  }, [active, lastEventAt])

  // ── Render ─────────────────────────────────────────────────────────────────

  const [showInfo, setShowInfo] = useState(false)

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col">

      {/* ── Info modal ──────────────────────────────────────────────────── */}
      {showInfo && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={() => setShowInfo(false)}>
          <div className="bg-slate-900 border border-slate-700 rounded-xl max-w-lg w-full p-6 shadow-2xl" onClick={e => e.stopPropagation()}>
            <div className="flex items-start justify-between mb-4">
              <h2 className="text-base font-bold text-slate-100">How this works — Saleroom shadow</h2>
              <button onClick={() => setShowInfo(false)} className="text-slate-500 hover:text-slate-300 text-xl leading-none ml-4">✕</button>
            </div>
            <div className="space-y-4 text-sm text-slate-300 leading-relaxed">
              <div>
                <p className="font-semibold text-white mb-1">🏷 Where does the data come from?</p>
                <p>The Saleroom platform (GAP) doesn't expose a public data feed. Instead, a small script is pasted into the browser console on the Saleroom page. It uses a <strong>MutationObserver</strong> — a browser API — to watch four elements on screen for any changes:</p>
                <ul className="list-disc list-inside mt-2 space-y-0.5 text-slate-400 text-xs">
                  <li><code className="bg-slate-800 px-1 rounded">hammer-price</code> — current bid</li>
                  <li><code className="bg-slate-800 px-1 rounded">asking-price</code> — next asking price</li>
                  <li><code className="bg-slate-800 px-1 rounded">lot-number</code> — current lot</li>
                  <li><code className="bg-slate-800 px-1 rounded">auction-message-content</code> — status messages (e.g. "Internet Bid", "Sold", "Fair Warning")</li>
                </ul>
              </div>
              <div>
                <p className="font-semibold text-white mb-1">📮 How does it get here?</p>
                <p>Whenever any of those elements change, the script POSTs the updated values to a <strong>relay API</strong> hosted on Railway (<code className="text-xs bg-slate-800 px-1 rounded">/api/gap-relay</code>). This page polls that relay every second and displays any new events.</p>
              </div>
              <div>
                <p className="font-semibold text-white mb-1">🔔 What events are shown?</p>
                <ul className="list-disc list-inside space-y-1 text-slate-400">
                  <li><strong className="text-blue-400">PRESS BID</strong> — Saleroom received an internet or room bid</li>
                  <li><strong className="text-green-400">PRESS SELL</strong> — lot sold on Saleroom; enter hammer price on Bidpath</li>
                  <li><strong className="text-purple-400">NEW LOT</strong> — Saleroom moved to a new lot</li>
                  <li><strong className="text-orange-400">FAIR WARNING</strong> — FW called on Saleroom (Bidpath handles its own FW)</li>
                </ul>
              </div>
              <div>
                <p className="font-semibold text-white mb-1">⚙️ Setup steps</p>
                <ol className="list-decimal list-inside space-y-1 text-slate-400">
                  <li>Click <strong className="text-white">Start polling</strong> on this page</li>
                  <li>Open the Saleroom live auction page in another tab</li>
                  <li>Click <strong className="text-white">Copy script</strong> above</li>
                  <li>On the Saleroom tab — press F12 → Console → paste → Enter</li>
                  <li>Events will appear here as bids come in</li>
                </ol>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Header */}
      <div className="border-b border-slate-800 px-6 py-4">
        <div className="flex items-center justify-between flex-wrap gap-4">
          <div className="flex items-center gap-3">
            <div>
              <h1 className="text-xl font-bold tracking-tight">Auto Clerk — Saleroom Shadow</h1>
              <p className="text-sm text-slate-400 mt-0.5">
                Reads live Saleroom (GAP) events — shows what to press on Bidpath
              </p>
            </div>
            <button
              onClick={() => setShowInfo(true)}
              title="How does this work?"
              className="w-6 h-6 rounded-full border border-slate-600 text-slate-400 hover:text-white hover:border-slate-400 text-xs font-bold flex items-center justify-center transition-colors shrink-0"
            >i</button>
          </div>
          <div className={`flex items-center gap-2 text-sm font-medium ${active ? (stale ? 'text-amber-400' : 'text-emerald-400') : 'text-slate-400'}`}>
            <span className={`w-2.5 h-2.5 rounded-full ${active ? (stale ? 'bg-amber-400' : 'bg-emerald-400 animate-pulse') : 'bg-slate-600'}`} />
            {active ? (stale ? 'No recent events — is the auction still running?' : 'Relay active') : 'Not polling'}
          </div>
        </div>

        {/* Step 1 — Relay URL */}
        <div className="mt-4 flex items-center gap-3 flex-wrap">
          <label className="text-xs text-slate-400 shrink-0">Relay endpoint:</label>

          {/* Quick-pick dropdown */}
          <select
            value={RELAY_PRESETS.some(p => p.url === relayUrl) ? relayUrl : ''}
            onChange={e => { if (e.target.value) setRelayUrl(e.target.value) }}
            disabled={active}
            className="bg-slate-800 border border-slate-700 rounded px-2 py-1.5 text-xs focus:outline-none focus:border-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {RELAY_PRESETS.map(p => (
              <option key={p.url} value={p.url}>{p.label}</option>
            ))}
            {!RELAY_PRESETS.some(p => p.url === relayUrl) && (
              <option value=''>Custom</option>
            )}
          </select>

          <input
            type="text"
            value={relayUrl}
            onChange={e => setRelayUrl(e.target.value)}
            disabled={active}
            className="bg-slate-800 border border-slate-700 rounded px-3 py-1.5 text-xs w-80 focus:outline-none focus:border-blue-500 font-mono disabled:opacity-50 disabled:cursor-not-allowed"
          />

          {!active ? (
            <button onClick={startPolling}
              className="bg-emerald-600 hover:bg-emerald-500 px-4 py-1.5 rounded text-sm font-semibold transition-colors">
              Start polling
            </button>
          ) : (
            <button onClick={stopPolling}
              className="bg-slate-700 hover:bg-slate-600 px-4 py-1.5 rounded text-sm font-semibold transition-colors">
              Stop
            </button>
          )}
        </div>

        {/* Step 2 — Console script */}
        <div className="mt-3">
          <div className="flex items-center gap-3 mb-1.5">
            <span className="text-xs text-slate-400">Console script — paste into DevTools on the Saleroom page:</span>
            <button
              onClick={() => {
                const script = `(function(){var R='${relayUrl}';var S={hammer:0,asking:0,lot:'',message:''};var T=null;function send(){fetch(R,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(Object.assign({},S,{at:Date.now()}))}).catch(function(e){console.error('Relay error:',e);})}function upd(k,v){S[k]=v;clearTimeout(T);T=setTimeout(send,100);}function watch(id,k,num){var el=document.getElementById(id);if(!el){console.warn('Not found:',id);return;}new MutationObserver(function(){var v=el.textContent.trim();upd(k,num?parseFloat(v.replace(/[^0-9.]/g,''))||0:v);}).observe(el,{childList:true,characterData:true,subtree:true});console.log('Watching:',id);}watch('hammer-price','hammer',true);watch('asking-price','asking',true);watch('lot-number','lot',false);watch('auction-message-content','message',false);console.log('Vectis relay started',R);})();`
                navigator.clipboard.writeText(script)
              }}
              className="bg-amber-600 hover:bg-amber-500 px-3 py-1 rounded text-xs font-semibold transition-colors shrink-0"
            >
              Copy script
            </button>
            <span className="text-xs text-slate-600">Then open F12 on the Saleroom page → Console → paste → Enter</span>
          </div>
        </div>
      </div>

      <div className="flex flex-1 gap-0 overflow-hidden">

        {/* Left — live state */}
        <div className="w-56 shrink-0 border-r border-slate-800 p-4 flex flex-col gap-4">
          <div>
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Saleroom state</p>
            <p className="text-2xl font-bold">{lotState.lot}</p>
            <p className="text-xs text-slate-400 mt-1 leading-snug">{lotState.message}</p>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="bg-slate-900 rounded p-2">
              <p className="text-xs text-slate-500">Current bid</p>
              <p className="text-sm font-semibold text-blue-300">{lotState.hammer > 0 ? fmt(lotState.hammer) : '—'}</p>
            </div>
            <div className="bg-slate-900 rounded p-2">
              <p className="text-xs text-slate-500">Asking</p>
              <p className="text-sm font-semibold text-slate-300">{lotState.asking > 0 ? fmt(lotState.asking) : '—'}</p>
            </div>
          </div>

          <div className="border-t border-slate-800 pt-3 mt-auto">
            <p className="text-xs text-slate-600 leading-relaxed">
              1. Start polling above<br/>
              2. Open Saleroom page<br/>
              3. Click Copy script above<br/>
              4. Events appear here live
            </p>
          </div>
        </div>

        {/* Right — sim panel + feed */}
        <div className="flex-1 flex flex-col overflow-hidden">

          {/* Fake Bidpath clerk screen */}
          <div className="shrink-0 border-b border-slate-800 bg-slate-900/40 px-4 py-3">
            <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-widest mb-3 flex items-center gap-2">
              <span className="w-1.5 h-1.5 rounded-full bg-amber-400 shrink-0" />
              Simulated Bidpath — buttons that would be pressed
            </p>
            <div className="flex gap-3 items-center flex-wrap">
              {/* Lot info */}
              <div className="bg-slate-950 border border-slate-700 rounded-lg px-4 py-2 text-center min-w-[100px] shrink-0">
                <p className="text-[9px] text-slate-500 uppercase tracking-wide">Lot</p>
                <p className="text-2xl font-black tabular-nums">{lotState.lot}</p>
                <div className="flex gap-3 justify-center mt-1">
                  <div>
                    <p className="text-[9px] text-slate-600">Bid</p>
                    <p className="text-xs font-bold text-blue-300">{lotState.hammer > 0 ? fmt(lotState.hammer) : '—'}</p>
                  </div>
                  <div>
                    <p className="text-[9px] text-slate-600">Ask</p>
                    <p className="text-xs font-bold text-slate-300">{lotState.asking > 0 ? fmt(lotState.asking) : '—'}</p>
                  </div>
                </div>
              </div>

              {/* BID! */}
              <div className={`px-4 py-2.5 rounded-lg font-bold text-sm transition-all duration-150 select-none ${
                simButton === 'bid'
                  ? 'bg-blue-500 text-white scale-105 ring-4 ring-blue-400 ring-offset-2 ring-offset-slate-950 shadow-lg shadow-blue-500/50'
                  : 'bg-slate-800 text-slate-500 border border-slate-700'
              }`}>
                BID!{simButton === 'bid' && simAmount > 0 ? ` — ${fmt(simAmount)}` : ''}
              </div>

              {/* HAMMER! — price box + button */}
              <div className="flex items-stretch gap-0 rounded-lg overflow-hidden">
                <div className={`px-3 py-2.5 font-mono font-bold text-sm transition-all duration-150 ${
                  simButton === 'sell'
                    ? 'bg-green-700 text-white'
                    : 'bg-slate-800 text-slate-500 border border-r-0 border-slate-700'
                }`}>
                  {simButton === 'sell' && simAmount > 0 ? fmt(simAmount) : '£ ——'}
                </div>
                <div className={`px-4 py-2.5 font-bold text-sm transition-all duration-150 select-none ${
                  simButton === 'sell'
                    ? 'bg-green-500 text-white scale-105 ring-4 ring-green-400 ring-offset-2 ring-offset-slate-950 shadow-lg shadow-green-500/50'
                    : 'bg-slate-800 text-slate-500 border border-slate-700'
                }`}>HAMMER!</div>
              </div>

              {/* NEXT LOT! */}
              <div className={`px-4 py-2.5 rounded-lg font-bold text-sm transition-all duration-150 select-none ${
                simButton === 'next'
                  ? 'bg-purple-500 text-white scale-105 ring-4 ring-purple-400 ring-offset-2 ring-offset-slate-950 shadow-lg shadow-purple-500/50'
                  : 'bg-slate-800 text-slate-500 border border-slate-700'
              }`}>NEXT LOT!</div>

              {/* FAIR WARNING! */}
              <div className={`px-4 py-2.5 rounded-lg font-bold text-sm transition-all duration-150 select-none ${
                simButton === 'fw'
                  ? 'bg-orange-500 text-white scale-105 ring-4 ring-orange-400 ring-offset-2 ring-offset-slate-950 shadow-lg shadow-orange-500/50'
                  : 'bg-slate-800 text-slate-500 border border-slate-700'
              }`}>FAIR WARNING!</div>
            </div>
          </div>

          {/* Action feed */}
          <div ref={feedRef} className="flex-1 overflow-y-auto p-4">
            {actions.length === 0 && (
              <div className="text-center text-slate-600 mt-20">
                <p className="text-4xl mb-3">🏷</p>
                <p className="text-sm">No events yet.</p>
                <p className="text-xs mt-1 text-slate-700">
                  Start polling, copy the script, paste it in the Saleroom Console.
                </p>
              </div>
            )}

            <div className="space-y-2">
              {actions.map(a => {
                const style = ACTION_STYLE[a.aType]
                return (
                  <div key={`${a.id}-${a.at}`}
                    className={`flex items-start gap-3 bg-slate-900 border-l-4 ${style.border} rounded-r px-4 py-3`}>
                    <span className={`${style.bg} text-white text-[10px] font-bold px-2 py-0.5 rounded shrink-0 mt-0.5 uppercase tracking-wide`}>
                      {style.badge}
                    </span>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium leading-snug">{a.headline}</p>
                      {a.detail && <p className="text-xs text-slate-400 mt-0.5">{a.detail}</p>}
                      {a.raw && <p className="text-[10px] text-slate-600 mt-0.5 italic">"{a.raw}"</p>}
                    </div>
                    <span className="text-[10px] text-slate-600 shrink-0 mt-1 tabular-nums">{a.at}</span>
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
