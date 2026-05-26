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
  bid:        { border: 'border-blue-500',   badge: 'PRESS BID',      bg: 'bg-blue-600' },
  sell:       { border: 'border-green-500',  badge: 'PRESS SELL',     bg: 'bg-green-600' },
  next:       { border: 'border-purple-400', badge: 'NEW LOT',        bg: 'bg-purple-600' },
  fw:         { border: 'border-orange-400', badge: 'FAIR WARNING',   bg: 'bg-orange-500' },
  info:       { border: 'border-slate-600',  badge: 'INFO',           bg: 'bg-slate-700' },
  connect:    { border: 'border-emerald-500',badge: 'RELAY ACTIVE',   bg: 'bg-emerald-600' },
  disconnect: { border: 'border-red-500',    badge: 'NO SIGNAL',      bg: 'bg-red-700' },
}

function fmt(n: number) { return '£' + n.toLocaleString('en-GB') }
function ts()           { return new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) }

function mapEvent(e: GapEvent): Action | null {
  const base = { id: e.id, at: new Date(e.at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' }), raw: e.message }

  switch (e.type) {
    case 'bid_internet':
      return { ...base, aType: 'bid',
        headline: `Press BID on Bidpath — ${fmt(e.hammer)}`,
        detail:   `Saleroom.com online bidder · Lot ${e.lot} · Asking ${fmt(e.asking)}` }

    case 'bid_room':
      return { ...base, aType: 'bid',
        headline: `Press BID on Bidpath — ${fmt(e.hammer)}`,
        detail:   `Room/phone bid via Saleroom · Lot ${e.lot} · Asking ${fmt(e.asking)}` }

    case 'lot_offered':
      return { ...base, aType: 'next',
        headline: `New lot starting on Saleroom — Lot ${e.lot}`,
        detail:   'Bidpath advances independently — no button press required unless out of sync' }

    case 'lot_sold':
      return { ...base, aType: 'sell',
        headline: `Press SELL on Bidpath — ${e.hammer > 0 ? fmt(e.hammer) : 'see Saleroom'}`,
        detail:   `${e.message} · Lot ${e.lot}` }

    case 'fair_warning':
      return { ...base, aType: 'fw',
        headline: 'Fair Warning called on Saleroom',
        detail:   'No Bidpath button press needed — Bidpath has its own FW mechanism' }

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

// ── Component ─────────────────────────────────────────────────────────────────

export default function AutoClerkSaleroomPage() {
  const [actions, setActions]       = useState<Action[]>([])
  const [relayUrl, setRelayUrl]     = useState('https://vectis-crm-production.up.railway.app/api/gap-relay')
  const [lastSeen, setLastSeen]     = useState(0)
  const [active, setActive]         = useState(false)
  const [lastEventAt, setLastEventAt] = useState<number | null>(null)
  const [lotState, setLotState]     = useState({ lot: '—', hammer: 0, asking: 0, message: '—' })

  const pollRef  = useRef<ReturnType<typeof setInterval> | null>(null)
  const feedRef  = useRef<HTMLDivElement | null>(null)
  const cursorRef = useRef(0)

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

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col">

      {/* Header */}
      <div className="border-b border-slate-800 px-6 py-4">
        <div className="flex items-center justify-between flex-wrap gap-4">
          <div>
            <h1 className="text-xl font-bold tracking-tight">Auto Clerk — Saleroom Shadow</h1>
            <p className="text-sm text-slate-400 mt-0.5">
              Reads live Saleroom (GAP) events — shows what to press on Bidpath
            </p>
          </div>
          <div className={`flex items-center gap-2 text-sm font-medium ${active ? (stale ? 'text-amber-400' : 'text-emerald-400') : 'text-slate-400'}`}>
            <span className={`w-2.5 h-2.5 rounded-full ${active ? (stale ? 'bg-amber-400' : 'bg-emerald-400 animate-pulse') : 'bg-slate-600'}`} />
            {active ? (stale ? 'No recent events — is the auction still running?' : 'Relay active') : 'Not polling'}
          </div>
        </div>

        {/* Step 1 — Relay URL */}
        <div className="mt-4 flex items-center gap-3 flex-wrap">
          <label className="text-xs text-slate-400 shrink-0">Relay endpoint:</label>
          <input
            type="text"
            value={relayUrl}
            onChange={e => setRelayUrl(e.target.value)}
            className="bg-slate-800 border border-slate-700 rounded px-3 py-1.5 text-xs w-96 focus:outline-none focus:border-blue-500 font-mono"
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

        {/* Right — action feed */}
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
  )
}
