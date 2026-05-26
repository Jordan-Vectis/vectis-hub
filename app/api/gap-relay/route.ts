import { NextRequest, NextResponse } from 'next/server'

// ── Types ─────────────────────────────────────────────────────────────────────

export interface GapEvent {
  id:      number
  at:      number   // unix ms
  message: string   // raw auction-message-content text
  hammer:  number   // current bid (hammer-price)
  asking:  number   // next asking price
  lot:     string   // lot-number text
  type:    GapEventType
}

export type GapEventType =
  | 'bid_internet'
  | 'bid_room'
  | 'lot_offered'
  | 'lot_sold'
  | 'fair_warning'
  | 'lot_passed'
  | 'auction_paused'
  | 'auction_resumed'
  | 'other'

// ── In-memory store (persists per Railway process) ────────────────────────────

let _events: GapEvent[] = []
let _nextId = 1
const MAX_EVENTS = 300

function classify(message: string): GapEventType {
  const m = message.toLowerCase()
  if (m.includes('internet bid'))                    return 'bid_internet'
  if (m.includes('room bid') || m === 'room bid')    return 'bid_room'
  if (m.includes('offered'))                         return 'lot_offered'
  if (m.includes('sold'))                            return 'lot_sold'
  if (m.includes('fair warning'))                    return 'fair_warning'
  if (m.includes('passed'))                          return 'lot_passed'
  if (m.includes('paused'))                          return 'auction_paused'
  if (m.includes('resumed') || m.includes('welcome')) return 'auction_resumed'
  return 'other'
}

// ── CORS headers (bookmarklet runs on a different origin) ─────────────────────

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS })
}

// ── POST — bookmarklet pushes events here ─────────────────────────────────────

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { message, hammer, asking, lot } = body

    if (!message || !message.trim()) {
      return NextResponse.json({ ok: true }, { headers: CORS })
    }

    // Suppress pure price-update noise (no meaningful message change)
    const msg = message.trim()
    const last = _events[_events.length - 1]
    if (last && last.message === msg && last.hammer === Number(hammer)) {
      return NextResponse.json({ ok: true, duplicate: true }, { headers: CORS })
    }

    const event: GapEvent = {
      id:      _nextId++,
      at:      Date.now(),
      message: msg,
      hammer:  Number(hammer) || 0,
      asking:  Number(asking) || 0,
      lot:     String(lot || ''),
      type:    classify(msg),
    }

    _events.push(event)
    if (_events.length > MAX_EVENTS) _events = _events.slice(-MAX_EVENTS)

    return NextResponse.json({ ok: true, id: event.id }, { headers: CORS })
  } catch (e: any) {
    console.error('gap-relay POST error:', e)
    return NextResponse.json({ error: e?.message ?? 'Unknown error' }, { status: 500, headers: CORS })
  }
}

// ── GET — shadow page polls here ──────────────────────────────────────────────

export async function GET(req: NextRequest) {
  try {
    const since  = parseInt(req.nextUrl.searchParams.get('since') || '0')
    const recent = _events.filter(e => e.id > since)
    return NextResponse.json(
      { events: recent, cursor: _nextId - 1 },
      { headers: CORS }
    )
  } catch (e: any) {
    console.error('gap-relay GET error:', e)
    return NextResponse.json({ error: e?.message ?? 'Unknown error' }, { status: 500, headers: CORS })
  }
}
