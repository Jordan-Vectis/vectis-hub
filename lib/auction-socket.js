// Live auction Socket.IO handler
// Ported from auction-live-app/server.js, integrated with Prisma/PostgreSQL
const { Pool } = require('pg')

const pool = new Pool({ connectionString: process.env.DATABASE_URL })

const CLERK_PASSWORD = process.env.CLERK_PASSWORD || 'clerk123'

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

function getPublicState() {
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

    // ── Clerk auth ──────────────────────────────────────────────────────────
    socket.on('clerk:auth', ({ password }) => {
      if (password !== CLERK_PASSWORD) {
        socket.emit('clerk:auth:fail', { message: 'Incorrect password' })
        return
      }
      clerkSockets.add(socket.id)
      socket.emit('clerk:auth:ok')
      // Send current state if auction is active
      if (activeAuction) socket.emit('auction:state', getPublicState())
    })

    // ── Load auction list ───────────────────────────────────────────────────
    socket.on('clerk:loadAuctions', async () => {
      if (!clerkSockets.has(socket.id)) return
      try {
        const auctions = await loadAuctionsFromDB()
        socket.emit('clerk:auctions', auctions)
      } catch (e) {
        socket.emit('clerk:error', { message: e.message })
      }
    })

    // ── Select auction ──────────────────────────────────────────────────────
    socket.on('clerk:selectAuction', async ({ auctionId }) => {
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
        io.emit('auction:state', getPublicState())
      } catch (e) {
        console.error('clerk:selectAuction', e)
        socket.emit('clerk:error', { message: e.message })
      }
    })

    // ── Start auction ───────────────────────────────────────────────────────
    socket.on('clerk:startAuction', async () => {
      if (!clerkSockets.has(socket.id) || !activeAuction) return
      const lot = getLiveLot()
      if (!lot) return
      activeAuction.status = 'ACTIVE'
      lot.status = 'ACTIVE'
      try { await setLiveAuctionInDB(activeAuction.id, 'ACTIVE') } catch(e) {}
      io.emit('auction:state', getPublicState())
    })

    // ── Pause auction ───────────────────────────────────────────────────────
    socket.on('clerk:pauseAuction', async () => {
      if (!clerkSockets.has(socket.id) || !activeAuction) return
      activeAuction.status = 'PAUSED'
      try { await updateLiveStateInDB(activeAuction.id, activeAuction.currentLotIndex, 'PAUSED') } catch(e) {}
      io.emit('auction:state', getPublicState())
    })

    // ── Resume auction (clears pause message) ───────────────────────────────
    socket.on('clerk:resumeAuction', async () => {
      if (!clerkSockets.has(socket.id) || !activeAuction) return
      activeAuction.status = 'ACTIVE'
      activeAuction.pauseMessage = null
      const lot = getLiveLot()
      if (lot && lot.status !== 'SOLD' && lot.status !== 'PASSED' && lot.status !== 'WITHDRAWN') {
        lot.status = 'ACTIVE'
      }
      try { await updateLiveStateInDB(activeAuction.id, activeAuction.currentLotIndex, 'ACTIVE') } catch(e) {}
      io.emit('auction:state', getPublicState())
    })

    // ── Close auction ───────────────────────────────────────────────────────
    socket.on('clerk:closeAuction', async () => {
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
      io.emit('auction:state', getPublicState())
      activeAuction = null
      activeLots = []
    })

    // ── Place bid (clerk) ───────────────────────────────────────────────────
    socket.on('clerk:bid', ({ type, bidderId, bidderName }) => {
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

      io.emit('auction:state', getPublicState())
      io.emit('bid:new', { amount, type: type || 'Room', lotNumber: lot.lotNumber })

      // Persist current bid to DB so My Bids page reflects live progress
      persistCurrentBid(lot.id, lot.currentBid)
    })

    // ── Set asking bid ──────────────────────────────────────────────────────
    socket.on('clerk:setAsking', ({ amount }) => {
      if (!clerkSockets.has(socket.id)) return
      const lot = getLiveLot()
      if (!lot) return
      lot.askingBid = parseInt(amount, 10)
      io.emit('auction:state', getPublicState())
    })

    // ── Set increment ───────────────────────────────────────────────────────
    socket.on('clerk:setIncrement', ({ amount }) => {
      if (!clerkSockets.has(socket.id)) return
      const lot = getLiveLot()
      if (!lot) return
      lot.increment = parseInt(amount, 10)
      lot.askingBid = lot.currentBid + lot.increment
      io.emit('auction:state', getPublicState())
    })

    // ── Fair warning ────────────────────────────────────────────────────────
    socket.on('clerk:fairWarning', () => {
      if (!clerkSockets.has(socket.id) || !activeAuction) return
      activeAuction.fairWarning = true
      io.emit('auction:fairWarning')
      io.emit('auction:state', getPublicState())
    })

    // ── Hammer ──────────────────────────────────────────────────────────────
    socket.on('clerk:hammer', async () => {
      if (!clerkSockets.has(socket.id) || !activeAuction) return
      const lot = getLiveLot()
      if (!lot) return
      lot.status = 'SOLD'
      lot.hammerPrice = lot.currentBid
      activeAuction.fairWarning = false
      try { await persistHammer(lot.id, lot.hammerPrice) } catch(e) { console.error('hammer persist:', e) }
      io.emit('lot:hammer', { lotNumber: lot.lotNumber, hammerPrice: lot.hammerPrice, title: lot.title })
      io.emit('auction:state', getPublicState())
      // Auto-advance after 3s
      setTimeout(() => advanceLot(io), 3000)
    })

    // ── Pass ────────────────────────────────────────────────────────────────
    socket.on('clerk:pass', () => {
      if (!clerkSockets.has(socket.id) || !activeAuction) return
      const lot = getLiveLot()
      if (!lot) return
      lot.status = 'PASSED'
      activeAuction.fairWarning = false
      io.emit('lot:result', { lotNumber: lot.lotNumber, result: 'PASSED' })
      io.emit('auction:state', getPublicState())
      setTimeout(() => advanceLot(io), 1500)
    })

    // ── Withdraw ────────────────────────────────────────────────────────────
    socket.on('clerk:withdraw', () => {
      if (!clerkSockets.has(socket.id) || !activeAuction) return
      const lot = getLiveLot()
      if (!lot) return
      lot.status = 'WITHDRAWN'
      activeAuction.fairWarning = false
      io.emit('auction:state', getPublicState())
      setTimeout(() => advanceLot(io), 1500)
    })

    // ── Undo last bid ───────────────────────────────────────────────────────
    socket.on('clerk:undo', () => {
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
      io.emit('auction:state', getPublicState())
    })

    // ── Navigation ──────────────────────────────────────────────────────────
    socket.on('clerk:nextLot', () => {
      if (!clerkSockets.has(socket.id) || !activeAuction) return
      advanceLot(io)
    })

    socket.on('clerk:prevLot', () => {
      if (!clerkSockets.has(socket.id) || !activeAuction) return
      if (activeAuction.currentLotIndex > 0) {
        activeAuction.currentLotIndex--
        activateLot(io)
      }
    })

    socket.on('clerk:goToLot', ({ index }) => {
      if (!clerkSockets.has(socket.id) || !activeAuction) return
      if (index >= 0 && index < activeLots.length) {
        activeAuction.currentLotIndex = index
        activateLot(io)
      }
    })

    // ── Add auto-bid ────────────────────────────────────────────────────────
    socket.on('clerk:addAutoBid', ({ bidderId, maxAmount }) => {
      if (!clerkSockets.has(socket.id)) return
      const lot = getLiveLot()
      if (!lot) return
      lot.autoBids = lot.autoBids.filter(a => a.bidderId !== bidderId)
      lot.autoBids.push({ bidderId, maxAmount: parseInt(maxAmount, 10) })
      io.emit('auction:state', getPublicState())
    })

    // ── Online bid from bidder ──────────────────────────────────────────────
    socket.on('bid:place', ({ amount, bidderId, bidderName }) => {
      if (!activeAuction || activeAuction.status !== 'ACTIVE') {
        socket.emit('bid:rejected', { reason: 'Auction not active' }); return
      }
      const lot = getLiveLot()
      if (!lot || lot.status !== 'ACTIVE') {
        socket.emit('bid:rejected', { reason: 'No active lot' }); return
      }
      const amt = parseInt(amount, 10)
      if (amt < lot.askingBid) {
        socket.emit('bid:rejected', { reason: `Minimum bid is £${lot.askingBid}` }); return
      }
      lot.currentBid = amt
      lot.bids.push({ amount: amt, type: 'Online', bidderId, bidderName, timestamp: new Date().toISOString() })
      lot.increment = getIncrement(lot.currentBid)
      lot.askingBid = lot.currentBid + lot.increment

      socket.emit('bid:accepted', { amount: amt })
      io.emit('auction:state', getPublicState())
      io.emit('bid:new', { amount: amt, type: 'Online', lotNumber: lot.lotNumber })
      // Alert clerk
      clerkSockets.forEach(id => {
        io.to(id).emit('bid:online', { bidderId, bidderName, amount: amt })
      })
    })

    // ── Commission / auto bid from bidder ──────────────────────────────────
    socket.on('bid:commission', async ({ lotId, maxAmount, bidderId, bidderName }) => {
      if (!activeAuction) {
        socket.emit('bid:commission:rejected', { reason: 'No active auction' }); return
      }
      const lot = activeLots.find(l => l.id === lotId)
      if (!lot) {
        socket.emit('bid:commission:rejected', { reason: 'Lot not found' }); return
      }
      if (lot.status === 'SOLD' || lot.status === 'PASSED' || lot.status === 'WITHDRAWN') {
        socket.emit('bid:commission:rejected', { reason: 'This lot has already been completed' }); return
      }
      if (!bidderId) {
        socket.emit('bid:commission:rejected', { reason: 'You must be logged in to place a commission bid' }); return
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
      lot.autoBids.push({ bidderId, bidderName: bidderName || null, maxAmount: amt })

      socket.emit('bid:commission:accepted', { lotId, lotNumber: lot.lotNumber, maxAmount: amt })
      // Refresh auctioneer view if this is the current lot
      io.emit('auction:state', getPublicState())
    })

    // ── Pause message ───────────────────────────────────────────────────────
    socket.on('clerk:setPauseMessage', ({ message }) => {
      if (!clerkSockets.has(socket.id) || !activeAuction) return
      activeAuction.pauseMessage = message || null
      io.emit('auction:state', getPublicState())
    })

    // ── Bidder hovering bid button ──────────────────────────────────────────
    socket.on('bidder:hoverBid', ({ hovering }) => {
      if (hovering) hoveringBidders.add(socket.id)
      else hoveringBidders.delete(socket.id)
      io.emit('bidder:hoveringCount', { count: hoveringBidders.size })
    })

    // ── Bidder join ─────────────────────────────────────────────────────────
    socket.on('bidder:join', ({ name, bidderId }) => {
      activeBidders[socket.id] = { id: bidderId || socket.id.slice(0, 8), name: name || 'Guest' }
      socket.emit('bidder:joined', { bidderId: activeBidders[socket.id].id })
      if (activeAuction) socket.emit('auction:state', getPublicState())
      // If a live camera stream is active, tell this viewer immediately
      if (broadcasterSocketId) socket.emit('webrtc:streamAvailable', { broadcasterId: broadcasterSocketId })
      io.emit('bidders:count', { count: Object.keys(activeBidders).length })
    })

    // ── WebRTC signaling ─────────────────────────────────────────────────────
    // Clerk goes live with camera
    socket.on('webrtc:ready', () => {
      if (!clerkSockets.has(socket.id)) return
      broadcasterSocketId = socket.id
      // Notify all connected viewers that a stream is available
      socket.broadcast.emit('webrtc:streamAvailable', { broadcasterId: socket.id })
    })

    // Clerk stops camera stream
    socket.on('webrtc:stop', () => {
      if (socket.id !== broadcasterSocketId) return
      broadcasterSocketId = null
      io.emit('webrtc:streamEnded')
    })

    // Relay WebRTC offer (viewer → broadcaster)
    socket.on('webrtc:offer', ({ targetId, offer }) => {
      io.to(targetId).emit('webrtc:offer', { offer, from: socket.id })
    })

    // Relay WebRTC answer (broadcaster → viewer)
    socket.on('webrtc:answer', ({ targetId, answer }) => {
      io.to(targetId).emit('webrtc:answer', { answer, from: socket.id })
    })

    // Relay ICE candidates (bidirectional)
    socket.on('webrtc:ice', ({ targetId, candidate }) => {
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
    io.emit('auction:state', getPublicState())
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
  io.emit('auction:state', getPublicState())
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
