// Custom Next.js server with Socket.IO for live auction support
const { createServer } = require('http')
const { parse }        = require('url')
const next             = require('next')
const { Server }       = require('socket.io')
const { Pool }         = require('pg')
const { setupAuctionSocket } = require('./lib/auction-socket')
require('dotenv').config()

const dev  = process.env.NODE_ENV !== 'production'
const port = parseInt(process.env.PORT || '3000', 10)
const app  = next({ dev })
const handle = app.getRequestHandler()

// Run pending Prisma migrations on startup.
// Some migrations were previously applied via `prisma db push` so the column
// already exists but the migration isn't recorded — we resolve those first so
// migrate deploy doesn't choke on them.
async function runMigrations() {
  const { execSync } = require('child_process')

  // Migrations to mark as applied without running (column already exists from db push)
  const preResolve = [
    '20260506090000_warehouse_tote_catalogued',
  ]

  for (const name of preResolve) {
    try {
      execSync(`npx prisma migrate resolve --applied "${name}"`, { timeout: 15000, stdio: 'pipe' })
      console.log(`> Resolved migration: ${name}`)
    } catch {
      // Already resolved or not in failed state — safe to ignore
    }
  }

  try {
    execSync('npx prisma migrate deploy', { timeout: 30000, stdio: 'inherit' })
    console.log('> Migrations applied')
  } catch (e) {
    console.warn('> prisma migrate deploy failed or timed out — server will start anyway:', e.message)
  }
}

// On startup, reset any stale ACTIVE/PAUSED live auctions to PENDING.
// The in-memory state is always lost on restart, so the public site
// must not show a live banner until a clerk explicitly presses Start.
async function resetStaleLiveAuctions() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL })
  try {
    const { rowCount } = await pool.query(
      `UPDATE "LiveAuction" SET status = 'PENDING', "updatedAt" = NOW()
       WHERE status IN ('ACTIVE', 'PAUSED')`
    )
    if (rowCount > 0) console.log(`> Reset ${rowCount} stale live auction(s) to PENDING`)
  } catch (e) {
    console.warn('> Could not reset stale live auctions:', e.message)
  } finally {
    await pool.end()
  }
}

app.prepare().then(async () => {
  await runMigrations()
  await resetStaleLiveAuctions()

  const httpServer = createServer((req, res) => {
    const parsedUrl = parse(req.url, true)
    handle(req, res, parsedUrl)
  })

  const io = new Server(httpServer, {
    cors: { origin: '*', methods: ['GET', 'POST'] },
    transports: ['websocket', 'polling'],
  })

  setupAuctionSocket(io)

  // Make io accessible to API routes via globalThis
  globalThis._io = io

  httpServer.listen(port, () => {
    console.log(`> Vectis Hub ready on http://localhost:${port}`)
    console.log(`> Socket.IO live auction server active`)

    // Background warehouse sync — runs every 20 minutes.
    // First run is delayed 2 minutes to let Next.js finish initialising.
    const SYNC_INTERVAL_MS = 12 * 60 * 60 * 1000
    const SYNC_INITIAL_DELAY_MS = 2 * 60 * 1000
    function runWarehouseSync() {
      const secret = process.env.CRON_SECRET
      if (!secret) { console.warn('[cron] CRON_SECRET not set — skipping warehouse sync') ; return }
      console.log('[cron/bc-warehouse] starting background sync')
      fetch(`http://localhost:${port}/api/cron/bc-warehouse`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${secret}` },
      })
        .then(r => r.json())
        .then(d => console.log('[cron/bc-warehouse] complete', JSON.stringify(d.results ?? {})))
        .catch(e => console.warn('[cron/bc-warehouse] error:', e.message))
    }
    setTimeout(() => {
      runWarehouseSync()
      setInterval(runWarehouseSync, SYNC_INTERVAL_MS)
    }, SYNC_INITIAL_DELAY_MS)
  })
})
