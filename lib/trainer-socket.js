// Saleroom Trainer — multi-device test mode
//
// Lets whoever is running public/saleroom-trainer.html host a throwaway practice
// sale that colleagues join from their own phones with a short room code, so the
// online bids arriving on the clerking screen are pressed by a real person
// instead of being generated on a timer.
//
// Deliberately nothing to do with lib/auction-socket.js. No database, no auth, no
// LiveAuction rows: rooms live in memory, hold invented lots and invented money,
// and disappear when the host disconnects. Keep it that way — the whole point is
// that a trainee cannot touch a real sale from here.

// Ambiguous glyphs left out so a code read aloud across a saleroom can't be
// misheard: no O/0, I/1, S/5, B/8, Z/2.
const CODE_CHARS = 'ACDEFGHJKLMNPQRTUVWXY34679'
const CODE_LEN = 4

const MAX_ROOMS = 50
const IDLE_ROOM_MS = 4 * 60 * 60 * 1000   // a forgotten tab shouldn't hold a code forever
const MIN_BID_GAP_MS = 350                // one paddle can't machine-gun the clerk
const MAX_BIDDERS = 30
const MAX_NAME_LEN = 24

/** code -> { code, hostId, state, bidders: Map<socketId, bidder>, paddleSeq, touched } */
const rooms = new Map()

function touch(room) { room.touched = Date.now() }

function sweepIdleRooms() {
  const now = Date.now()
  for (const [code, room] of rooms) {
    if (now - room.touched > IDLE_ROOM_MS) rooms.delete(code)
  }
}

function makeCode() {
  for (let attempt = 0; attempt < 200; attempt++) {
    let code = ''
    for (let i = 0; i < CODE_LEN; i++) {
      code += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]
    }
    if (!rooms.has(code)) return code
  }
  return null
}

function normaliseCode(code) {
  return String(code || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '')
}

function cleanName(name) {
  const trimmed = String(name || '').trim().replace(/\s+/g, ' ').slice(0, MAX_NAME_LEN)
  return trimmed || 'Guest'
}

function roster(room) {
  return [...room.bidders.values()].map(b => ({ paddle: b.paddle, name: b.name }))
}

function pushRoster(io, room) {
  if (!room.hostId) return
  io.to(room.hostId).emit('trainer:bidders', { bidders: roster(room) })
}

function setupTrainerSocket(io) {
  setInterval(sweepIdleRooms, 15 * 60 * 1000).unref?.()

  io.on('connection', (socket) => {
    // Which room this socket belongs to, so disconnect can clean up without a scan.
    let hostedCode = null
    let joinedCode = null
    let lastBidAt = 0
    let lastHover = null

    // ── HOST (the clerking screen) ───────────────────────────────────────────
    socket.on('trainer:host', (payload, ack) => {
      const reply = typeof ack === 'function' ? ack : () => {}
      sweepIdleRooms()

      if (rooms.size >= MAX_ROOMS) {
        reply({ ok: false, error: 'Too many training rooms are open — try again shortly.' })
        return
      }

      const code = makeCode()
      if (!code) { reply({ ok: false, error: 'Could not allocate a room code.' }); return }

      const room = {
        code,
        hostId: socket.id,
        state: (payload && payload.state) || null,
        // What the sale is called in the "join a running sale" lists.
        label: String((payload && payload.label) || '').trim().slice(0, 60),
        bidders: new Map(),
        // Bidder numbers mimic the real platform's SR customer numbers
        // (e.g. SR1766576) — seven digits from a random base per room.
        paddleSeq: 1500000 + Math.floor(Math.random() * 8000000),
        touched: Date.now(),
      }
      rooms.set(code, room)
      hostedCode = code
      socket.join(`trainer:${code}`)
      reply({ ok: true, code })
    })

    // Host pushes the whole visible sale state after every change; bidders render
    // whatever they last received. Cheap, and it means a phone that joins late or
    // reconnects is immediately correct without replaying anything.
    socket.on('trainer:state', ({ code, state } = {}) => {
      const room = rooms.get(normaliseCode(code))
      if (!room || room.hostId !== socket.id) return
      room.state = state || null
      touch(room)
      socket.to(`trainer:${room.code}`).emit('trainer:state', state || null)
    })

    // Result of a bid the host just processed — accepted, or rejected with a reason.
    socket.on('trainer:bidResult', ({ code, bidderId, accepted, message } = {}) => {
      const room = rooms.get(normaliseCode(code))
      if (!room || room.hostId !== socket.id) return
      if (!bidderId || !room.bidders.has(bidderId)) return
      io.to(bidderId).emit('trainer:bidResult', { accepted: !!accepted, message: message || '' })
    })

    socket.on('trainer:end', ({ code } = {}) => {
      const room = rooms.get(normaliseCode(code))
      if (!room || room.hostId !== socket.id) return
      socket.to(`trainer:${room.code}`).emit('trainer:closed', { reason: 'ended' })
      rooms.delete(room.code)
      hostedCode = null
    })

    // Open practice sales, so a colleague can join one from the trainer menu or
    // the bidder page without anyone sending codes around. Staff-only surface:
    // every page that can ask sits behind the Hub login.
    socket.on('trainer:listRooms', (ack) => {
      const reply = typeof ack === 'function' ? ack : () => {}
      sweepIdleRooms()
      reply({
        ok: true,
        rooms: [...rooms.values()].map(r => ({
          code: r.code,
          label: r.label || '',
          bidders: r.bidders.size,
          lot: r.state && r.state.lot ? String(r.state.lot.id) : null,
        })),
      })
    })

    // ── BIDDER (a phone) ─────────────────────────────────────────────────────
    socket.on('trainer:join', ({ code, name } = {}, ack) => {
      const reply = typeof ack === 'function' ? ack : () => {}
      const room = rooms.get(normaliseCode(code))

      if (!room) { reply({ ok: false, error: 'No practice sale is running with that code.' }); return }
      if (room.bidders.size >= MAX_BIDDERS) { reply({ ok: false, error: 'This practice sale is full.' }); return }

      // Joining a different room leaves the old one properly, so a socket can
      // never sit in two bidder lists at once.
      if (joinedCode && joinedCode !== room.code) {
        const prev = rooms.get(joinedCode)
        if (prev && prev.bidders.delete(socket.id)) {
          socket.leave(`trainer:${joinedCode}`)
          pushRoster(io, prev)
          if (prev.hostId) io.to(prev.hostId).emit('trainer:hover', { bidderId: socket.id, hovering: false })
        }
      }

      // Rejoining from the same tab keeps the paddle, so a phone that locks and
      // wakes up doesn't come back as a different bidder mid-lot.
      const existing = room.bidders.get(socket.id)
      const bidder = existing || { paddle: 'SR' + room.paddleSeq++, name: cleanName(name) }
      bidder.name = cleanName(name)
      room.bidders.set(socket.id, bidder)

      joinedCode = room.code
      socket.join(`trainer:${room.code}`)
      touch(room)
      pushRoster(io, room)

      reply({ ok: true, code: room.code, paddle: bidder.paddle, name: bidder.name, state: room.state })
    })

    // A bidder pressing (or hovering over) their BID button — relayed to the
    // host so the clerk's screen can show a live "Hovering" count, the same
    // signal the real operator software gives the rostrum.
    socket.on('trainer:hover', ({ code, hovering } = {}) => {
      const room = rooms.get(normaliseCode(code))
      if (!room || !room.hostId) return
      if (!room.bidders.has(socket.id)) return
      const h = !!hovering
      if (h === lastHover) return   // relay only actual changes — no spamming the host
      lastHover = h
      io.to(room.hostId).emit('trainer:hover', { bidderId: socket.id, hovering: h })
    })

    socket.on('trainer:bid', ({ code, amount } = {}) => {
      const room = rooms.get(normaliseCode(code))
      if (!room) { socket.emit('trainer:closed', { reason: 'gone' }); return }

      const bidder = room.bidders.get(socket.id)
      if (!bidder || !room.hostId) return

      const value = Number(amount)
      if (!Number.isFinite(value) || value <= 0) return

      const now = Date.now()
      if (now - lastBidAt < MIN_BID_GAP_MS) {
        // Answer rather than drop: the phone locks its button until it hears
        // back, so a silent drop would leave it stuck until the next state push.
        socket.emit('trainer:bidResult', { accepted: false, message: 'Steady on — one press at a time' })
        return
      }
      lastBidAt = now

      touch(room)
      io.to(room.hostId).emit('trainer:bid', {
        bidderId: socket.id,
        paddle: bidder.paddle,
        name: bidder.name,
        amount: Math.round(value),
      })
    })

    socket.on('disconnect', () => {
      if (hostedCode) {
        const room = rooms.get(hostedCode)
        if (room && room.hostId === socket.id) {
          socket.to(`trainer:${hostedCode}`).emit('trainer:closed', { reason: 'host-left' })
          rooms.delete(hostedCode)
        }
      }
      if (joinedCode) {
        const room = rooms.get(joinedCode)
        if (room && room.bidders.delete(socket.id)) {
          pushRoster(io, room)
          // A phone that vanished mid-press must not leave the Hovering count stuck.
          if (room.hostId) io.to(room.hostId).emit('trainer:hover', { bidderId: socket.id, hovering: false })
        }
      }
    })
  })
}

module.exports = { setupTrainerSocket }
