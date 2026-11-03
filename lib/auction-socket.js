// Live auction Socket.IO handler
// Ported from auction-live-app/server.js, integrated with Prisma/PostgreSQL
const { Pool } = require('pg')
const { createHmac, randomBytes } = require('crypto')

const pool = new Pool({ connectionString: process.env.DATABASE_URL })

// pg-pool emits 'error' on the POOL when an idle client's connection dies
// (a Neon compute restart, a pooler dropping the connection). With no listener
// Node treats that as an unhandled 'error' event and the whole server process
// exits — every user dropped, mid-sale included. The pool has already thrown
// the dead client away and opens a fresh one on the next query, so logging is
// all that is needed. Message and code only — never the connection string.
pool.on('error', (err) => {
  console.error(`> Live auction DB pool: idle connection lost (${err.code || 'no code'}): ${err.message}`)
})

// ─── Clerk access = the Hub login (2026-10-22) ────────────────────────────────
// No shared clerk password any more: the socket reads the person's Hub login cookie and gives the
// clerk controls to anyone with Auction Controller access (admins always), read fresh from the
// database — the same rule as hasAppAccess in lib/apps.ts. Two-factor on the login covers it too.
const SUPERADMIN_EMAILS = ['it@vectis.co.uk'] // keep in step with auth.ts

function parseCookies(cookieHeader) {
  const jar = {}
  for (const part of (cookieHeader || '').split(';')) {
    const i = part.indexOf('=')
    if (i <= 0) continue
    const raw = part.slice(i + 1).trim()
    try { jar[part.slice(0, i).trim()] = decodeURIComponent(raw) } catch { jar[part.slice(0, i).trim()] = raw }
  }
  return jar
}

async function hubUserFromCookie(cookieHeader) {
  const secret = process.env.AUTH_SECRET || process.env.NEXTAUTH_SECRET
  if (!secret || !cookieHeader) return null
  const jar = parseCookies(cookieHeader)
  const { decode } = await import('@auth/core/jwt')
  for (const name of ['__Secure-authjs.session-token', 'authjs.session-token']) {
    let token = jar[name]
    if (!token) { // a big login cookie is split into name.0, name.1, …
      const parts = []
      for (let i = 0; jar[`${name}.${i}`]; i++) parts.push(jar[`${name}.${i}`])
      token = parts.join('')
    }
    if (!token) continue
    const t = await decode({ token, secret, salt: name }).catch(() => null)
    if (t && t.id) return t
  }
  return null
}

async function canClerk(cookieHeader) {
  const t = await hubUserFromCookie(cookieHeader)
  if (!t) return { ok: false, message: 'Sign in to the Hub first, then open the Auction Controller again.' }
  const { rows } = await pool.query('SELECT name, email, role, "allowedApps" FROM "User" WHERE id = $1', [t.id])
  const u = rows[0]
  if (!u) return { ok: false, message: 'Your Hub account could not be found.' }
  const admin = u.role === 'ADMIN' || SUPERADMIN_EMAILS.includes(String(u.email).toLowerCase())
  if (!admin && !(u.allowedApps || []).includes('AUCTION_CONTROLLER')) {
    return { ok: false, message: "You don't have Auction Controller access — ask an admin to tick it in Users & Permissions." }
  }
  return { ok: true, name: u.name }
}

// ─── Bidders = the customer login (security review, 2026-11-03) ──────────────────
// Anyone on the internet can open this socket — server.js lets a connection with no Origin through,
// which is what a script sends. So a bid is only ever taken from a customer signed in to their Vectis
// account (the httpOnly `customer-token` cookie, the same one lib/customer-auth.ts reads) who is
// registered for the sale, and always AS that customer: a bidder id or name the page sends is ignored.
// Until then anyone could bid, or place and overwrite commission bids, in any customer's name.
async function customerFromCookie(cookieHeader) {
  const token = parseCookies(cookieHeader)['customer-token']
  if (!token) return null
  const { rows } = await pool.query(
    'SELECT id, "firstName", "lastName" FROM "CustomerAccount" WHERE "sessionToken" = $1', [token])
  const c = rows[0]
  return c ? { id: c.id, name: `${c.firstName ?? ''} ${c.lastName ?? ''}`.trim() || 'Online Bidder' } : null
}

// The customer behind a socket, looked up once. A failed lookup is not remembered, so the next try asks again.
async function customerOf(socket) {
  if (socket.data.customer !== undefined) return socket.data.customer
  const c = await customerFromCookie(socket.handshake.headers.cookie)
  socket.data.customer = c
  return c
}

// May this socket bid in the sale that is running? { customer } if so, otherwise { reason } to show them.
async function bidderFor(socket) {
  const auctionId = activeAuction?.id
  let customer
  try {
    customer = await customerOf(socket)
    if (!customer) return { reason: 'Sign in to your Vectis account to bid.' }
    if (!auctionId) return { reason: 'No active auction' }
    const seen = socket.data.registeredFor || (socket.data.registeredFor = new Set())
    if (!seen.has(auctionId)) {
      const { rows } = await pool.query(
        'SELECT 1 FROM "BidderRegistration" WHERE "auctionId" = $1 AND "customerAccountId" = $2', [auctionId, customer.id])
      if (!rows.length) return { reason: 'You must register to bid before placing a bid.' }
      seen.add(auctionId)
    }
  } catch (e) {
    console.error('> Live auction bidder check failed:', e.message)
    return { reason: "Couldn't check your account just now — try again in a moment." }
  }
  // The sale may have changed while the account was looked up.
  if (activeAuction?.id !== auctionId) return { reason: 'No active auction' }
  return { customer }
}

// ─── Who sees what ────────────────────────────────────────────────────────────────
// The FULL state — bidders' names and account ids, and the top commission bid's ceiling — goes only to
// staff: the Auction Controller (clerk:auth) and the auctioneer and results screens (staff:watch), all
// on the Auction Controller rule in canClerk. Every other socket gets the public copy, where a bidder
// is an anonymous paddle that stays the same for the life of this process (as the live state does) and
// a customer is told their own paddle on bidder:join, so their page can still say "You are winning".
const STAFF_ROOM = 'staff'
const PADDLE_KEY = randomBytes(32)

function paddleFor(bidderId) {
  if (!bidderId) return null
  return 'P' + createHmac('sha256', PADDLE_KEY).update(String(bidderId)).digest('hex').slice(0, 10)
}

function publicState(full) {
  const bid = (b) => ({ amount: b.amount, type: b.type, bidderId: paddleFor(b.bidderId), timestamp: b.timestamp })
  return {
    ...full,
    currentLot: full.currentLot
      ? { ...full.currentLot, bids: full.currentLot.bids.map(bid), topAutoBid: null }
      : null,
    previousLot: full.previousLot
      ? { ...full.previousLot, buyerName: null, buyerId: paddleFor(full.previousLot.buyerId) }
      : null,
  }
}

function stateFor(socket) {
  const full = getFullState()
  return socket.rooms.has(STAFF_ROOM) ? full : publicState(full)
}

function broadcastState(io) {
  const full = getFullState()
  io.to(STAFF_ROOM).emit('auction:state', full)
  io.except(STAFF_ROOM).emit('auction:state', publicState(full))
}

// A handler must never be able to take the server down or leave a rejection unheard: a payload that
// isn't an object (a script can send anything) is replaced by {} before it is unpacked.
function on(socket, event, handler) {
  socket.on(event, (payload) => {
    const p = payload && typeof payload === 'object' ? payload : {}
    try {
      const r = handler(p)
      if (r && typeof r.catch === 'function') r.catch(e => console.error(`> Live auction ${event}:`, e?.message ?? e))
    } catch (e) {
      console.error(`> Live auction ${event}:`, e?.message ?? e)
    }
  })
}

// ─── Increment table ──────────────────────────────────────────────────────────
function getIncrement(bid) {
  if (bid <    50) return 5
  if (bid <   200) return 10
  if (bid <   700) return 20
  if (bid <  1000) return 50
  if (bid <  3000) return 100
  if (bid <  7000) return 200
  if (bid < 10000) return 500
  return 1000
}

// ─── In-memory live state ─────────────────────────────────────────────────────
let activeAuction      = null   // { id, title, code, status, currentLotIndex, fairWarning }
let activeLots         = []     // LiveLot[]
let activeBidders      = {}     // socketId → { id, name, isRegistered }
let clerkSockets       = new Set()
let broadcasterSocketId = null  // socket ID of the clerk streaming camera
let hoveringBidders    = new Set() // socket IDs currently hovering the BID button

function getLiveLot() {
  if (!activeAuction) return null
  return activeLots[activeAuction.currentLotIndex] ?? null
}

// Everything — staff only. Everyone else is sent publicState() of it (see "Who sees what" above).
function getFullState() {
  const lot = getLiveLot()
  const state = {
    auction: activeAuction ? {
      id:              activeAuction.id,
      title:           activeAuction.title,
      code:            activeAuction.code,
      status:          activeAuction.status,
      currentLotIndex: activeAuction.currentLotIndex,
      fairWarning:     activeAuction.fairWarning,
      pauseMessage:    activeAuction.pauseMessage ?? null,
      totalLots:       activeLots.length,
    } : null,
    currentLot: lot ? {
      id:          lot.id,
      lotNumber:   lot.lotNumber,
      title:       lot.title,
      description: lot.description,
      imageUrls:   lot.imageUrls,
      estimateLow: lot.estimateLow,
      estimateHigh:lot.estimateHigh,
      status:      lot.status,
      currentBid:  lot.currentBid,
      askingBid:   lot.askingBid,
      increment:   lot.increment,
      hammerPrice: lot.hammerPrice,
      bids:        lot.bids.slice(-20), // last 20 bids
      // Top auto-bid (for auctioneer screen)
      topAutoBid:  lot.autoBids?.length > 0
        ? lot.autoBids.reduce((max, ab) => ab.maxAmount > max.maxAmount ? ab : max, lot.autoBids[0])
        : null,
    } : null,
    lots: activeLots.map(l => ({
      id: l.id, lotNumber: l.lotNumber, title: l.title,
      status: l.status, hammerPrice: l.hammerPrice,
      currentBid: l.currentBid,
    })),
    onlineCount:    Object.keys(activeBidders).length,
    hoveringCount:  hoveringBidders.size,
    // Previous lot (last sold or passed before current index)
    previousLot: (() => {
      if (!activeAuction) return null
      for (let i = (activeAuction.currentLotIndex - 1); i >= 0; i--) {
        const l = activeLots[i]
        if (l && (l.status === 'SOLD' || l.status === 'PASSED' || l.status === 'WITHDRAWN')) {
          const buyer = l.bids.length > 0 ? l.bids[l.bids.length - 1] : null
          return {
            lotNumber:  l.lotNumber,
            title:      l.title,
            status:     l.status,
            hammerPrice: l.hammerPrice,
            buyerName:  buyer?.bidderName ?? null,
            buyerId:    buyer?.bidderId ?? null,
          }
        }
      }
      return null
    })(),
  }
  // Expose to Next.js API routes via globalThis
  globalThis._liveState = state
  return state
}

// ─── DB helpers ───────────────────────────────────────────────────────────────
async function loadAuctionsFromDB() {
  const { rows } = await pool.query(`
    SELECT ca.id, ca.code, ca.name, ca."auctionDate", ca."auctionType",
           ca.published, ca.finished, ca.complete,
           COUNT(cl.id)::int AS "lotCount"
    FROM "CatalogueAuction" ca
    LEFT JOIN "CatalogueLot" cl ON cl."auctionId" = ca.id
    GROUP BY ca.id
    ORDER BY ca."auctionDate" DESC NULLS LAST
  `)
  return rows
}

async function loadLotsFromDB(auctionId) {
  const { rows } = await pool.query(`
    SELECT id, barcode, "receiptUniqueId", title, description, "imageUrls",
           "estimateLow", "estimateHigh", reserve, "hammerPrice",
           condition, vendor, tote, receipt, category, "subCategory",
           brand, notes, status
    FROM "CatalogueLot"
    WHERE "auctionId" = $1
    ORDER BY "createdAt"
  `, [auctionId])

  const lots = rows.map(row => ({
    id:          row.id,
    lotNumber:   row.barcode || row.receiptUniqueId || row.id,
    title:       row.title || '',
    description: row.description || '',
    imageUrls:   row.imageUrls || [],
    estimateLow: row.estimateLow,
    estimateHigh:row.estimateHigh,
    reserve:     row.reserve,
    startingBid: row.estimateLow || 0,
    status:      row.hammerPrice ? 'SOLD' : 'PENDING',
    currentBid:  0,
    askingBid:   row.estimateLow || 10,
    increment:   getIncrement(0),
    hammerPrice: row.hammerPrice,
    bids:        [],
    autoBids:    [],
  }))

  // Pre-load any existing commission bids for these lots
  if (lots.length > 0) {
    const lotIds = lots.map(l => l.id)
    const { rows: cbRows } = await pool.query(`
      SELECT "lotId", "customerAccountId", "maxBid"
      FROM "CommissionBid"
      WHERE "lotId" = ANY($1)
    `, [lotIds])
    for (const cb of cbRows) {
      const lot = lots.find(l => l.id === cb.lotId)
      if (lot) {
        lot.autoBids.push({ bidderId: cb.customerAccountId, maxAmount: cb.maxBid })
      }
    }
  }

  return lots
}

async function persistHammer(lotId, hammerPrice) {
  await pool.query(
    `UPDATE "CatalogueLot" SET "hammerPrice" = $1, "currentBid" = $1, status = 'SOLD', "updatedAt" = NOW() WHERE id = $2`,
    [hammerPrice, lotId]
  )
}

async function persistCurrentBid(lotId, currentBid) {
  try {
    await pool.query(
      `UPDATE "CatalogueLot" SET "currentBid" = $1, "updatedAt" = NOW() WHERE id = $2`,
      [currentBid, lotId]
    )
  } catch (e) {
    // Non-critical — in-memory state is authoritative during live auction
    console.warn('persistCurrentBid failed:', e.message)
  }
}

async function setLiveAuctionInDB(auctionId, status) {
  await pool.query(`
    INSERT INTO "LiveAuction" (id, "auctionId", status, "currentLotIndex", "createdAt", "updatedAt")
    VALUES (gen_random_uuid()::text, $1, $2, 0, NOW(), NOW())
    ON CONFLICT ("auctionId") DO UPDATE SET status = $2, "updatedAt" = NOW()
  `, [auctionId, status])
}

async function updateLiveStateInDB(auctionId, lotIndex, status) {
  await pool.query(`
    UPDATE "LiveAuction" SET status = $2, "currentLotIndex" = $3, "updatedAt" = NOW()
    WHERE "auctionId" = $1
  `, [auctionId, status, lotIndex])
}

// ─── Main setup ───────────────────────────────────────────────────────────────
function setupAuctionSocket(io) {

  io.on('connection', (socket) => {
    // Look the customer up straight away, so their first bid doesn't wait on it.
    customerOf(socket).catch(() => {})

    // ── Clerk auth ──────────────────────────────────────────────────────────
    on(socket, 'clerk:auth', async () => {
      let check
      try { check = await canClerk(socket.handshake.headers.cookie) }
      catch (e) {
        console.error('> Clerk access check failed:', e.message)
        socket.emit('clerk:auth:fail', { message: "Couldn't check your access just now — try again in a moment." })
        return
      }
      if (!check.ok) {
        socket.emit('clerk:auth:fail', { message: check.message })
        return
      }
      console.log(`> Clerk controls opened by ${check.name}`)
      clerkSockets.add(socket.id)
      socket.join(STAFF_ROOM)
      socket.emit('clerk:auth:ok')
      // Send current state if auction is active
      if (activeAuction) socket.emit('auction:state', getFullState())
    })

    // ── Staff screens that watch without clerking (auctioneer, results) ─────
    // Same rule as the clerk controls. Refused, the screen carries on with the public copy and says why.
    on(socket, 'staff:watch', async () => {
      let check
      try { check = await canClerk(socket.handshake.headers.cookie) }
      catch (e) {
        console.error('> Staff watch check failed:', e.message)
        socket.emit('staff:watch:fail', { message: "Couldn't check your access just now — reload to try again." })
        return
      }
      if (!check.ok) { socket.emit('staff:watch:fail', { message: check.message }); return }
      socket.join(STAFF_ROOM)
      if (activeAuction) socket.emit('auction:state', getFullState())
    })

    // ── Load auction list ───────────────────────────────────────────────────
    on(socket, 'clerk:loadAuctions', async () => {
      if (!clerkSockets.has(socket.id)) return
      try {
        const auctions = await loadAuctionsFromDB()
        socket.emit('clerk:auctions', auctions)
      } catch (e) {
        socket.emit('clerk:error', { message: e.message })
      }
    })

    // ── Select auction ──────────────────────────────────────────────────────
    on(socket, 'clerk:selectAuction', async ({ auctionId }) => {
      if (!clerkSockets.has(socket.id)) return
      try {
        const { rows } = await pool.query(
          `SELECT id, name, code, "auctionType" FROM "CatalogueAuction" WHERE id = $1`,
          [auctionId]
        )
        if (!rows[0]) { socket.emit('clerk:error', { message: 'Auction not found' }); return }

        const lots = await loadLotsFromDB(auctionId)
        activeAuction = {
          id: rows[0].id, title: rows[0].name, code: rows[0].code,
          status: 'PENDING', currentLotIndex: 0, fairWarning: false, pauseMessage: null,
        }
        activeLots = lots

        // Reset any existing live auction record to PENDING so the public
        // site banner doesn't appear until the clerk presses Start.
        await pool.query(
          `UPDATE "LiveAuction" SET status = 'PENDING', "updatedAt" = NOW() WHERE "auctionId" = $1`,
          [auctionId]
        )

        socket.emit('clerk:auctionLoaded', { auction: activeAuction, lots: activeLots })
        broadcastState(io)
      } catch (e) {
        console.error('clerk:selectAuction', e)
        socket.emit('clerk:error', { message: e.message })
      }
    })

    // ── Start auction ───────────────────────────────────────────────────────
    on(socket, 'clerk:startAuction', async () => {
      if (!clerkSockets.has(socket.id) || !activeAuction) return
      const lot = getLiveLot()
      if (!lot) return
      activeAuction.status = 'ACTIVE'
      lot.status = 'ACTIVE'
      try { await setLiveAuctionInDB(activeAuction.id, 'ACTIVE') } catch(e) {}
      broadcastState(io)
    })

    // ── Pause auction ───────────────────────────────────────────────────────
    on(socket, 'clerk:pauseAuction', async () => {
      if (!clerkSockets.has(socket.id) || !activeAuction) return
      activeAuction.status = 'PAUSED'
      try { await updateLiveStateInDB(activeAuction.id, activeAuction.currentLotIndex, 'PAUSED') } catch(e) {}
      broadcastState(io)
    })

    // ── Resume auction (clears pause message) ───────────────────────────────
    on(socket, 'clerk:resumeAuction', async () => {
      if (!clerkSockets.has(socket.id) || !activeAuction) return
      activeAuction.status = 'ACTIVE'
      activeAuction.pauseMessage = null
      const lot = getLiveLot()
      if (lot && lot.status !== 'SOLD' && lot.status !== 'PASSED' && lot.status !== 'WITHDRAWN') {
        lot.status = 'ACTIVE'
      }
      try { await updateLiveStateInDB(activeAuction.id, activeAuction.currentLotIndex, 'ACTIVE') } catch(e) {}
      broadcastState(io)
    })

    // ── Close auction ───────────────────────────────────────────────────────
    on(socket, 'clerk:closeAuction', async () => {
      if (!clerkSockets.has(socket.id) || !activeAuction) return
      const auctionId = activeAuction.id
      activeAuction.status = 'COMPLETE'
      try {
        await updateLiveStateInDB(auctionId, activeAuction.currentLotIndex, 'COMPLETE')
        // Mark the catalogue auction as finished so it appears on the past auctions page
        await pool.query(
          `UPDATE "CatalogueAuction" SET finished = true, "updatedAt" = NOW() WHERE id = $1`,
          [auctionId]
        )
      } catch(e) { console.error('closeAuction DB:', e.message) }
      broadcastState(io)
      activeAuction = null
      activeLots = []
    })

    // ── Place bid (clerk) ───────────────────────────────────────────────────
    on(socket, 'clerk:bid', ({ type, bidderId, bidderName }) => {
      if (!clerkSockets.has(socket.id) || !activeAuction) return
      if (activeAuction.status !== 'ACTIVE') return
      const lot = getLiveLot()
      if (!lot || lot.status !== 'ACTIVE') return

      const amount = lot.askingBid
      lot.currentBid = amount
      lot.bids.push({ amount, type: type || 'Room', bidderId: bidderId || null, bidderName: bidderName || null, timestamp: new Date().toISOString() })

      // Process auto-bids
      processAutoBids(lot, amount)

      lot.increment = getIncrement(lot.currentBid)
      lot.askingBid = lot.currentBid + lot.increment
      activeAuction.fairWarning = false

      broadcastState(io)
      io.emit('bid:new', { amount, type: type || 'Room', lotNumber: lot.lotNumber })

      // Persist current bid to DB so My Bids page reflects live progress
      persistCurrentBid(lot.id, lot.currentBid)
    })

    // ── Set asking bid ──────────────────────────────────────────────────────
    on(socket, 'clerk:setAsking', ({ amount }) => {
      if (!clerkSockets.has(socket.id)) return
      const lot = getLiveLot()
      if (!lot) return
      lot.askingBid = parseInt(amount, 10)
      broadcastState(io)
    })

    // ── Set increment ───────────────────────────────────────────────────────
    on(socket, 'clerk:setIncrement', ({ amount }) => {
      if (!clerkSockets.has(socket.id)) return
      const lot = getLiveLot()
      if (!lot) return
      lot.increment = parseInt(amount, 10)
      lot.askingBid = lot.currentBid + lot.increment
      broadcastState(io)
    })

    // ── Fair warning ────────────────────────────────────────────────────────
    on(socket, 'clerk:fairWarning', () => {
      if (!clerkSockets.has(socket.id) || !activeAuction) return
      activeAuction.fairWarning = true
      io.emit('auction:fairWarning')
      broadcastState(io)
    })

    // ── Hammer ──────────────────────────────────────────────────────────────
    on(socket, 'clerk:hammer', async () => {
      if (!clerkSockets.has(socket.id) || !activeAuction) return
      const lot = getLiveLot()
      if (!lot) return
      lot.status = 'SOLD'
      lot.hammerPrice = lot.currentBid
      activeAuction.fairWarning = false
      try { await persistHammer(lot.id, lot.hammerPrice) } catch(e) { console.error('hammer persist:', e) }
      io.emit('lot:hammer', { lotNumber: lot.lotNumber, hammerPrice: lot.hammerPrice, title: lot.title })
      broadcastState(io)
      // Auto-advance after 3s
      setTimeout(() => advanceLot(io), 3000)
    })

    // ── Pass ────────────────────────────────────────────────────────────────
    on(socket, 'clerk:pass', () => {
      if (!clerkSockets.has(socket.id) || !activeAuction) return
      const lot = getLiveLot()
      if (!lot) return
      lot.status = 'PASSED'
      activeAuction.fairWarning = false
      io.emit('lot:result', { lotNumber: lot.lotNumber, result: 'PASSED' })
      broadcastState(io)
      setTimeout(() => advanceLot(io), 1500)
    })

    // ── Withdraw ────────────────────────────────────────────────────────────
    on(socket, 'clerk:withdraw', () => {
      if (!clerkSockets.has(socket.id) || !activeAuction) return
      const lot = getLiveLot()
      if (!lot) return
      lot.status = 'WITHDRAWN'
      activeAuction.fairWarning = false
      broadcastState(io)
      setTimeout(() => advanceLot(io), 1500)
    })

    // ── Undo last bid ───────────────────────────────────────────────────────
    on(socket, 'clerk:undo', () => {
      if (!clerkSockets.has(socket.id)) return
      const lot = getLiveLot()
      if (!lot || lot.bids.length === 0) return
      lot.bids.pop()
      const prev = lot.bids[lot.bids.length - 1]
      lot.currentBid = prev ? prev.amount : 0
      lot.increment = getIncrement(lot.currentBid)
      lot.askingBid = lot.currentBid + lot.increment
      lot.status = 'ACTIVE'
      activeAuction.fairWarning = false
      broadcastState(io)
    })

    // ── Navigation ──────────────────────────────────────────────────────────
    on(socket, 'clerk:nextLot', () => {
      if (!clerkSockets.has(socket.id) || !activeAuction) return
      advanceLot(io)
    })

    on(socket, 'clerk:prevLot', () => {
      if (!clerkSockets.has(socket.id) || !activeAuction) return
      if (activeAuction.currentLotIndex > 0) {
        activeAuction.currentLotIndex--
        activateLot(io)
      }
    })

    on(socket, 'clerk:goToLot', ({ index }) => {
      if (!clerkSockets.has(socket.id) || !activeAuction) return
      if (index >= 0 && index < activeLots.length) {
        activeAuction.currentLotIndex = index
        activateLot(io)
      }
    })

    // ── Add auto-bid ────────────────────────────────────────────────────────
    on(socket, 'clerk:addAutoBid', ({ bidderId, maxAmount }) => {
      if (!clerkSockets.has(socket.id)) return
      const lot = getLiveLot()
      if (!lot) return
      lot.autoBids = lot.autoBids.filter(a => a.bidderId !== bidderId)
      lot.autoBids.push({ bidderId, maxAmount: parseInt(maxAmount, 10) })
      broadcastState(io)
    })

    // ── Online bid from bidder ──────────────────────────────────────────────
    // ⚠ The bidder is whoever the customer cookie says (bidderFor), never a bidderId in the payload.
    on(socket, 'bid:place', async ({ amount }) => {
      if (!activeAuction || activeAuction.status !== 'ACTIVE') {
        socket.emit('bid:rejected', { reason: 'Auction not active' }); return
      }
      const who = await bidderFor(socket)
      if (who.reason) { socket.emit('bid:rejected', { reason: who.reason }); return }
      // The lot is read AFTER the account check — another bid may have landed while it ran.
      if (!activeAuction || activeAuction.status !== 'ACTIVE') {
        socket.emit('bid:rejected', { reason: 'Auction not active' }); return
      }
      const lot = getLiveLot()
      if (!lot || lot.status !== 'ACTIVE') {
        socket.emit('bid:rejected', { reason: 'No active lot' }); return
      }
      const { id: bidderId, name: bidderName } = who.customer
      if (lot.bids[lot.bids.length - 1]?.bidderId === bidderId) {
        socket.emit('bid:rejected', { reason: 'You are already the highest bidder' }); return
      }
      // Exactly the asking bid — the Bid button only ever offers that. More is a jump bid sent by a
      // script; less means someone else bid first.
      const amt = parseInt(amount, 10)
      if (amt !== lot.askingBid) {
        socket.emit('bid:rejected', { reason: `The asking bid is now £${lot.askingBid} — press Bid again` }); return
      }
      lot.currentBid = amt
      lot.bids.push({ amount: amt, type: 'Online', bidderId, bidderName, timestamp: new Date().toISOString() })
      lot.increment = getIncrement(lot.currentBid)
      lot.askingBid = lot.currentBid + lot.increment

      socket.emit('bid:accepted', { amount: amt })
      broadcastState(io)
      io.emit('bid:new', { amount: amt, type: 'Online', lotNumber: lot.lotNumber })
      // Alert clerk
      clerkSockets.forEach(id => {
        io.to(id).emit('bid:online', { bidderId, bidderName, amount: amt })
      })
    })

    // ── Commission / auto bid from bidder ──────────────────────────────────
    // ⚠ As bid:place: the customer cookie decides whose bid it is, so nobody can place or overwrite a
    // commission bid in another customer's name.
    on(socket, 'bid:commission', async ({ lotId, maxAmount }) => {
      if (!activeAuction) {
        socket.emit('bid:commission:rejected', { reason: 'No active auction' }); return
      }
      const who = await bidderFor(socket)
      if (who.reason) { socket.emit('bid:commission:rejected', { reason: who.reason }); return }
      const { id: bidderId, name: bidderName } = who.customer
      const lot = activeLots.find(l => l.id === lotId)
      if (!lot) {
        socket.emit('bid:commission:rejected', { reason: 'Lot not found' }); return
      }
      if (lot.status === 'SOLD' || lot.status === 'PASSED' || lot.status === 'WITHDRAWN') {
        socket.emit('bid:commission:rejected', { reason: 'This lot has already been completed' }); return
      }
      const amt = parseInt(maxAmount, 10)
      if (!amt || amt <= 0) {
        socket.emit('bid:commission:rejected', { reason: 'Please enter a valid amount' }); return
      }

      // Persist to DB so it appears in My Bids
      try {
        await pool.query(`
          INSERT INTO "CommissionBid" (id, "lotId", "customerAccountId", "maxBid", "placedAt", "updatedAt")
          VALUES (gen_random_uuid()::text, $1, $2, $3, NOW(), NOW())
          ON CONFLICT ("lotId", "customerAccountId") DO UPDATE SET "maxBid" = $3, "updatedAt" = NOW()
        `, [lotId, bidderId, amt])
      } catch (e) {
        console.error('commission bid persist failed:', e.message)
        socket.emit('bid:commission:rejected', { reason: 'Failed to save bid — please try again' }); return
      }

      // Update in-memory auto bids
      lot.autoBids = lot.autoBids.filter(a => a.bidderId !== bidderId)
      lot.autoBids.push({ bidderId, bidderName, maxAmount: amt })

      socket.emit('bid:commission:accepted', { lotId, lotNumber: lot.lotNumber, maxAmount: amt })
      // Refresh auctioneer view if this is the current lot
      broadcastState(io)
    })

    // ── Pause message ───────────────────────────────────────────────────────
    on(socket, 'clerk:setPauseMessage', ({ message }) => {
      if (!clerkSockets.has(socket.id) || !activeAuction) return
      activeAuction.pauseMessage = message || null
      broadcastState(io)
    })

    // ── Bidder hovering bid button ──────────────────────────────────────────
    on(socket, 'bidder:hoverBid', ({ hovering }) => {
      if (hovering) hoveringBidders.add(socket.id)
      else hoveringBidders.delete(socket.id)
      io.emit('bidder:hoveringCount', { count: hoveringBidders.size })
    })

    // ── Bidder join ─────────────────────────────────────────────────────────
    // A signed-in customer is told their own paddle, so their page can spot their bids in the public
    // state; a guest gets null. The name and id the page sends are not trusted for anything.
    on(socket, 'bidder:join', async ({ name }) => {
      let customer = null
      try { customer = await customerOf(socket) } catch { /* a guest until the lookup works */ }
      if (socket.disconnected) return
      const paddle = customer ? paddleFor(customer.id) : null
      activeBidders[socket.id] = { id: paddle || socket.id.slice(0, 8), name: customer?.name || String(name || 'Guest').slice(0, 80) }
      socket.emit('bidder:joined', { bidderId: paddle })
      if (activeAuction) socket.emit('auction:state', stateFor(socket))
      // If a live camera stream is active, tell this viewer immediately
      if (broadcasterSocketId) socket.emit('webrtc:streamAvailable', { broadcasterId: broadcasterSocketId })
      io.emit('bidders:count', { count: Object.keys(activeBidders).length })
    })

    // ── WebRTC signaling ─────────────────────────────────────────────────────
    // Clerk goes live with camera
    on(socket, 'webrtc:ready', () => {
      if (!clerkSockets.has(socket.id)) return
      broadcasterSocketId = socket.id
      // Notify all connected viewers that a stream is available
      socket.broadcast.emit('webrtc:streamAvailable', { broadcasterId: socket.id })
    })

    // Clerk stops camera stream
    on(socket, 'webrtc:stop', () => {
      if (socket.id !== broadcasterSocketId) return
      broadcasterSocketId = null
      io.emit('webrtc:streamEnded')
    })

    // ⚠ The relays only ever join a viewer to the camera — never one viewer to another, or an outsider
    // could message (or pose as the camera to) any socket whose id they knew.

    // Relay WebRTC offer (viewer → broadcaster)
    on(socket, 'webrtc:offer', ({ targetId, offer }) => {
      if (!broadcasterSocketId || targetId !== broadcasterSocketId) return
      io.to(targetId).emit('webrtc:offer', { offer, from: socket.id })
    })

    // Relay WebRTC answer (broadcaster → viewer)
    on(socket, 'webrtc:answer', ({ targetId, answer }) => {
      if (socket.id !== broadcasterSocketId || !targetId) return
      io.to(targetId).emit('webrtc:answer', { answer, from: socket.id })
    })

    // Relay ICE candidates (bidirectional, but one end is always the broadcaster)
    on(socket, 'webrtc:ice', ({ targetId, candidate }) => {
      if (!broadcasterSocketId || !targetId) return
      if (socket.id !== broadcasterSocketId && targetId !== broadcasterSocketId) return
      io.to(targetId).emit('webrtc:ice', { candidate, from: socket.id })
    })

    // ── Disconnect ──────────────────────────────────────────────────────────
    socket.on('disconnect', () => {
      clerkSockets.delete(socket.id)
      delete activeBidders[socket.id]
      hoveringBidders.delete(socket.id)
      // If broadcaster disconnects, notify viewers
      if (socket.id === broadcasterSocketId) {
        broadcasterSocketId = null
        io.emit('webrtc:streamEnded')
      }
      io.emit('bidders:count', { count: Object.keys(activeBidders).length })
      io.emit('bidder:hoveringCount', { count: hoveringBidders.size })
    })
  })
}

function advanceLot(io) {
  if (!activeAuction) return
  if (activeAuction.currentLotIndex < activeLots.length - 1) {
    activeAuction.currentLotIndex++
    activateLot(io)
  } else {
    activeAuction.status = 'COMPLETE'
    updateLiveStateInDB(activeAuction.id, activeAuction.currentLotIndex, 'COMPLETE').catch(() => {})
    broadcastState(io)
  }
}

function activateLot(io) {
  if (!activeAuction) return
  const lot = getLiveLot()
  if (!lot) return
  if (activeAuction.status === 'ACTIVE') {
    lot.status = 'ACTIVE'
  }
  activeAuction.fairWarning = false
  updateLiveStateInDB(activeAuction.id, activeAuction.currentLotIndex, activeAuction.status).catch(() => {})
  broadcastState(io)
}

function processAutoBids(lot, newBid) {
  const eligible = lot.autoBids
    .filter(ab => ab.bidderId !== (lot.bids[lot.bids.length - 1]?.bidderId))
    .filter(ab => ab.maxAmount > newBid)
    .sort((a, b) => b.maxAmount - a.maxAmount)

  if (eligible.length > 0) {
    const winner = eligible[0]
    const nextAsk = newBid + getIncrement(newBid)
    if (winner.maxAmount >= nextAsk) {
      lot.currentBid = nextAsk
      lot.bids.push({ amount: nextAsk, type: 'Auto', bidderId: winner.bidderId, timestamp: new Date().toISOString() })
    }
  }
}

module.exports = { setupAuctionSocket }
