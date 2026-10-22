import { NextResponse } from 'next/server'
import { auth } from '@/auth'

export const dynamic = 'force-dynamic'

// Signed-in only (security review, 2026-10-22). Nothing in the Hub calls this today; it stays for
// staff tools rather than being an open window onto the live sale.
export async function GET() {
  try {
    const session = await auth()
    if (!session) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

    // Read live auction state from in-memory Socket.IO server
    const io = (globalThis as any)._io
    if (!io) {
      return NextResponse.json({ auction: null, currentLot: null, lots: [], onlineCount: 0 })
    }

    // Access the shared state exported by auction-socket.js via globalThis
    const state = (globalThis as any)._liveState
    if (!state) {
      return NextResponse.json({ auction: null, currentLot: null, lots: [], onlineCount: 0 })
    }

    return NextResponse.json(state)
  } catch (e: any) {
    console.error('live-state error:', e)
    return NextResponse.json({ error: e?.message ?? 'Unknown error' }, { status: 500 })
  }
}
