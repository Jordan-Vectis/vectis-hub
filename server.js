// Custom Next.js server with Socket.IO for live auction support
const { createServer } = require('http')
const { parse }        = require('url')
const next             = require('next')
const { Server }       = require('socket.io')
const { Pool }         = require('pg')
const { setupAuctionSocket } = require('./lib/auction-socket')
const { setupTrainerSocket } = require('./lib/trainer-socket')
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
  // Same guard as lib/auction-socket.js: a connection dying while idle emits
  // 'error' on the pool, and unheard it would crash the boot.
  pool.on('error', (err) => {
    console.warn(`> Stale-live-auction reset pool: idle connection lost (${err.code || 'no code'}): ${err.message}`)
  })
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
  // Both of these write to whatever DATABASE_URL points at, and .env on a dev
  // machine points at the SHARED Neon database — not a local copy. So they are
  // gated to a real deployment: a local boot would otherwise push migrations
  // outside the deliberate Run Migrations button, and reset a genuinely live
  // auction to PENDING, dropping the live banner off the public site mid-sale.
  // Railway is NODE_ENV=production, so nothing changes there.
  if (dev) {
    console.log('> Dev mode — skipping migrations + stale-live-auction reset (they target the shared DB)')
  } else {
    await runMigrations()
    await resetStaleLiveAuctions()
  }

  const httpServer = createServer((req, res) => {
    const parsedUrl = parse(req.url, true)
    handle(req, res, parsedUrl)
  })

  const io = new Server(httpServer, {
    cors: { origin: '*', methods: ['GET', 'POST'] },
    transports: ['websocket', 'polling'],
  })

  setupAuctionSocket(io)
  // Saleroom Trainer test mode — in-memory practice rooms only, never a real sale.
  setupTrainerSocket(io)

  // Make io accessible to API routes via globalThis
  globalThis._io = io

  httpServer.listen(port, () => {
    console.log(`> Vectis Hub ready on http://localhost:${port}`)
    console.log(`> Socket.IO live auction server active`)

    // When this process started — the Status Centre's "The Hub" light shows it, so a
    // restart (a crash, or a deploy) is visible after the fact.
    globalThis._bootedAt = Date.now()

    // The loops below drive real integrations: they back up the shared DB to R2
    // and turn real IT@vectis.co.uk / condition-report emails into records. On a
    // dev machine they no-op only because CRON_SECRET happens to be absent from
    // .env — that accident is not worth relying on, since copying the Railway
    // variables across to run locally would have the mailbox polls processing
    // live mail 90 seconds later. Railway is NODE_ENV=production and schedules
    // them exactly as before.
    if (dev) {
      console.log('> Dev mode — background cron loops not scheduled')
      return
    }

    // ⚠ The cron routes below ANSWER AT ONCE and run their work in the background (2026-09-18).
    // They used to hold the request open for the whole job, and Node's fetch gives up waiting for
    // headers after 300 s — so every long job printed "fetch failed" while it carried on and
    // finished. Each route now logs its own result; these lines only say whether it STARTED.
    // `e.cause?.code` is printed because "fetch failed" on its own can't tell a timeout
    // (UND_ERR_HEADERS_TIMEOUT) from a server that is down (ECONNREFUSED).
    const why = (e) => `${e.message}${e.cause?.code ? ` (${e.cause.code})` : ''}`

    // Incremental warehouse sync — 11:00 and 17:00 London, catching up through the working day.
    //
    // ⚠⚠ FIXED TIMES, not "every 12 hours from boot" (changed 2026-09-18). Counting from boot put
    // it wherever Railway last deployed, and after one deploy it landed on top of the 05:00 FULL:
    // two walks at once in one 10-connection pool, which turned the Status Centre's database light
    // at five in the morning. The FULL covers overnight, so nothing is lost by not running then.
    // (The route also holds an in-process lock, so an overlap can't happen even if these move.)
    const INCREMENTAL_LONDON_HOURS = [11, 17]
    function runWarehouseSync() {
      const secret = process.env.CRON_SECRET
      if (!secret) { console.warn('[cron] CRON_SECRET not set — skipping warehouse sync') ; return }
      console.log('[cron/bc-warehouse] starting background sync')
      fetch(`http://localhost:${port}/api/cron/bc-warehouse`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${secret}` },
      })
        .then(r => r.json())
        .then(d => console.log(d.started
          ? '[cron/bc-warehouse] started — it logs its own result when it finishes'
          : `[cron/bc-warehouse] not started — ${d.skipped ?? d.error ?? 'no reason given'}`))
        .catch(e => console.warn('[cron/bc-warehouse] could not start:', why(e)))
    }
    function scheduleWarehouseSync() {
      const wait = Math.min(...INCREMENTAL_LONDON_HOURS.map(msUntilLondonHour))
      console.log(`[cron/bc-warehouse] next incremental sync in ${Math.round(wait / 1000 / 60)} minutes`)
      // Re-armed a minute AFTER firing, so a timer landing a hair early can't compute "0 ms to
      // go" and fire the same hour twice.
      setTimeout(() => { runWarehouseSync(); setTimeout(scheduleWarehouseSync, 60 * 1000) }, wait)
    }
    scheduleWarehouseSync()

    // Full warehouse re-sync — 05:00 UK, an hour after the overnight BC macro finishes.
    //
    // ⚠⚠ WHY THIS EXISTS SEPARATELY FROM THE 12-HOURLY RUN. That one is INCREMENTAL: it only asks
    // Business Central for rows BC says have changed, and BC does not always say. A lot given its
    // number in BC does not get its SystemModifiedAt bumped, which is how 94 lots sat with no lot
    // number until a top-up was bolted on. Only a full walk closes that class of gap.
    //
    // ⚠ Scheduled in EUROPE/LONDON and re-armed after every run, not on a fixed 24-hour interval.
    // A fixed interval drifts an hour each way at the clock changes, and the 12-hourly job's
    // "every N ms from boot" means its timing follows whenever Railway last deployed.
    function msUntilLondonHour(hour) {
      const now = new Date()
      // What time is it in London right now, as plain numbers.
      const parts = new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Europe/London', hour12: false,
        hour: '2-digit', minute: '2-digit', second: '2-digit',
      }).formatToParts(now).reduce((a, p) => (a[p.type] = p.value, a), {})
      const h = Number(parts.hour) % 24, m = Number(parts.minute), sec = Number(parts.second)
      const secsNow    = h * 3600 + m * 60 + sec
      const secsTarget = hour * 3600
      const delta = secsTarget - secsNow
      return (delta > 0 ? delta : delta + 24 * 3600) * 1000
    }
    // ⚠ If the FULL can't start (another sync is still running), it tries again in 10 minutes
    // rather than waiting until tomorrow — the whole point of the 05:00 run is that the morning's
    // BC Match starts from a complete copy. Capped at six tries, then it waits for the next day.
    let fullRetries = 0
    function runFullWarehouseSync() {
      const secret = process.env.CRON_SECRET
      if (!secret) { console.warn('[cron] CRON_SECRET not set — skipping full warehouse sync') ; return }
      console.log('[cron/bc-warehouse] starting FULL sync')
      const tomorrow = () => { fullRetries = 0; setTimeout(runFullWarehouseSync, msUntilLondonHour(5)) }
      const retrySoon = (reason) => {
        if (++fullRetries > 6) { console.warn(`[cron/bc-warehouse] FULL gave up for today — ${reason}`); return tomorrow() }
        console.warn(`[cron/bc-warehouse] FULL waiting — ${reason}; trying again in 10 minutes (${fullRetries}/6)`)
        setTimeout(runFullWarehouseSync, 10 * 60 * 1000)
      }
      fetch(`http://localhost:${port}/api/cron/bc-warehouse`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${secret}` },
        body: JSON.stringify({ full: true }),
      })
        .then(r => r.json())
        .then(d => {
          if (d.started) {
            console.log('[cron/bc-warehouse] FULL started — it logs its own result when it finishes')
            tomorrow()
          } else {
            retrySoon(d.skipped ?? d.error ?? 'did not start')
          }
        })
        .catch(e => retrySoon(`could not reach the route: ${why(e)}`))
    }
    {
      const wait = msUntilLondonHour(5)
      console.log(`[cron/bc-warehouse] next FULL sync in ${Math.round(wait / 1000 / 60)} minutes`)
      setTimeout(runFullWarehouseSync, wait)
    }

    // Daily database backup — runs once at midnight UTC, then every 24 hours.
    function runDbBackup() {
      const secret = process.env.CRON_SECRET
      if (!secret) { console.warn('[cron] CRON_SECRET not set — skipping db backup') ; return }
      console.log('[cron/db-backup] starting daily backup')
      fetch(`http://localhost:${port}/api/cron/db-backup`, {
        method: 'GET',
        headers: { Authorization: `Bearer ${secret}` },
      })
        .then(r => r.json())
        .then(d => console.log('[cron/db-backup] complete:', d.filename, `(${d.sizeBytes} bytes)`))
        .catch(e => console.warn('[cron/db-backup] error:', e.message))
    }
    const now = new Date()
    const nextMidnightUTC = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1, 0, 0, 0))
    const msUntilMidnight = nextMidnightUTC - now
    console.log(`[cron/db-backup] next backup in ${Math.round(msUntilMidnight / 1000 / 60)} minutes`)
    setTimeout(() => {
      runDbBackup()
      setInterval(runDbBackup, 24 * 60 * 60 * 1000)
    }, msUntilMidnight)

    // Auto Pipeline queue — works through the queued sales overnight so a run no
    // longer needs the browser tab left open. Each tick does about nine minutes
    // of work and returns; the next one carries on from the same lot. Ticking
    // every 30s keeps the gap between slices small, and a tick is a cheap no-op
    // whenever a slice is already in flight or the queue is empty.
    const PIPELINE_TICK_MS = 30 * 1000
    // ⚠ This flag now only covers the tick's own few-millisecond request. It is NOT the guard
    // against two slices on one sale — it used to be, and it dropped at the 300 s fetch timeout
    // while the slice ran on. The real guard is the in-process lock in lib/pipeline-runner.ts.
    let pipelineTickBusy = false
    function runPipelineQueue() {
      const secret = process.env.CRON_SECRET
      if (!secret) return   // silent: this loop ticks constantly, unlike the others
      if (pipelineTickBusy) return
      pipelineTickBusy = true
      fetch(`http://localhost:${port}/api/cron/pipeline-queue`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${secret}` },
      })
        .then(r => r.json())
        // Silent on success: the route only STARTS a slice now, and the slice logs its own outcome.
        .then(d => { if (d && d.error) console.warn('[cron/pipeline-queue] error:', d.error) })
        .catch(e => console.warn('[cron/pipeline-queue] could not start a slice:', why(e)))
        .finally(() => { pipelineTickBusy = false })
    }
    setTimeout(() => {
      runPipelineQueue()
      setInterval(runPipelineQueue, PIPELINE_TICK_MS)
    }, 60 * 1000)

    // IT mailbox poll — turns new IT@vectis.co.uk emails into Job Board jobs.
    // Every 5 minutes, first run delayed 90s. No-op until the mailbox is connected.
    const IT_MAILBOX_INTERVAL_MS = 5 * 60 * 1000
    function runITMailboxSync() {
      const secret = process.env.CRON_SECRET
      if (!secret) return
      fetch(`http://localhost:${port}/api/cron/it-mailbox`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${secret}` },
      })
        .then(r => r.json())
        .then(d => { if (d && d.created) console.log(`[cron/it-mailbox] created ${d.created} job(s)`) })
        .catch(e => console.warn('[cron/it-mailbox] error:', e.message))
    }
    setTimeout(() => {
      runITMailboxSync()
      setInterval(runITMailboxSync, IT_MAILBOX_INTERVAL_MS)
    }, 90 * 1000)

    // Condition-reports mailbox poll — turns new condition-report emails into
    // Condition Reports. Every 5 minutes, first run delayed 100s. No-op until
    // the mailbox is connected and CONDITION_MAILBOX is set.
    const CONDITION_MAILBOX_INTERVAL_MS = 5 * 60 * 1000
    function runConditionMailboxSync() {
      const secret = process.env.CRON_SECRET
      if (!secret) return
      fetch(`http://localhost:${port}/api/cron/condition-mailbox`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${secret}` },
      })
        .then(r => r.json())
        .then(d => { if (d && d.created) console.log(`[cron/condition-mailbox] created ${d.created} report(s)`) })
        .catch(e => console.warn('[cron/condition-mailbox] error:', e.message))
    }
    setTimeout(() => {
      runConditionMailboxSync()
      setInterval(runConditionMailboxSync, CONDITION_MAILBOX_INTERVAL_MS)
    }, 100 * 1000)

    // 🚦 Status Centre — checks every outside service the Hub relies on and records the
    // result, so /admin/status can answer "is it us or a supplier?" and the admin bell can
    // say when something breaks or recovers. Each tick runs only the checks that are due.
    //
    // ⚠ PRODUCTION ONLY. On staging and sandbox it would wake their Neon branches every tick
    // (the database check opens ~28 connections) and ring bells about test copies of
    // production's data. There, the page's "Check now" runs the same checks on demand.
    // ⚠ Not gated on CRON_SECRET like the loops above: each check is read-only (no emails,
    // no orders, no AI generation, no probe rows), and it proves itself to its own route
    // with a token made fresh at boot and held only in this process.
    globalThis._statusToken = require('crypto').randomBytes(24).toString('hex')
    const STATUS_INTERVAL_MS = 5 * 60 * 1000
    let statusBusy = false
    function runStatusChecks() {
      if (process.env.RAILWAY_ENVIRONMENT_NAME !== 'production') return
      if (statusBusy) return
      statusBusy = true
      fetch(`http://localhost:${port}/api/status/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-status-token': globalThis._statusToken },
        body: '{}',
      })
        .then(r => r.json())
        .then(d => { if (d && d.changed && d.changed.length) console.log(`[status] changed: ${d.changed.join(', ')}`) })
        .catch(e => console.warn('[status] error:', e.message))
        .finally(() => { statusBusy = false })
    }
    setTimeout(() => {
      runStatusChecks()
      setInterval(runStatusChecks, STATUS_INTERVAL_MS)
    }, 2 * 60 * 1000)
  })
})
