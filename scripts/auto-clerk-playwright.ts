/**
 * Auto Clerk — Playwright Bridge Script
 *
 * Connects to the real (or simulated) Bidpath and Saleroom pages
 * and keeps them in sync automatically.
 *
 * Sync logic:
 *   - Bidpath gets new bid → clicks Bid on Saleroom (steps up to match)
 *   - Saleroom gets room bid → clicks Saleroom button on Bidpath (steps up to match)
 *   - 10s silence → Fair Warning on both
 *   - 10s after FW → Hammer on Bidpath, then fill H + Sell + Next on Saleroom
 *
 * Usage (simulated pages):
 *   npx ts-node scripts/auto-clerk-playwright.ts
 *
 * Usage (real pages — provide both URLs):
 *   npx ts-node scripts/auto-clerk-playwright.ts \
 *     --bidpath=https://bidpath.vectis.co.uk/clerk \
 *     --saleroom=https://www.the-saleroom.com/clerk
 */

import { chromium, Page } from 'playwright'

// ── CONFIG ──────────────────────────────────────────────────────────────────
const arg = (flag: string) => process.argv.find(a => a.startsWith(flag + '='))?.split('=').slice(1).join('=')

const BASE_URL     = arg('--base') ?? 'http://localhost:3000'
const BIDPATH_URL  = arg('--bidpath')  ?? `${BASE_URL}/auto-clerk-bidpath.html`
const SALEROOM_URL = arg('--saleroom') ?? `${BASE_URL}/auto-clerk-saleroom.html`

const SILENCE_BEFORE_FW_MS     = parseInt(arg('--silence') ?? '10000')
const SILENCE_BEFORE_HAMMER_MS = parseInt(arg('--fw-delay') ?? '10000')

console.log(`Bidpath:  ${BIDPATH_URL}`)
console.log(`Saleroom: ${SALEROOM_URL}`)
console.log(`Silence before FW:     ${SILENCE_BEFORE_FW_MS / 1000}s`)
console.log(`Silence before Hammer: ${SILENCE_BEFORE_HAMMER_MS / 1000}s`)

// ── HELPERS ──────────────────────────────────────────────────────────────────
function log(msg: string) {
  const t = new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
  console.log(`[${t}] ${msg}`)
}

async function getBidpathState(page: Page) {
  return {
    state:      (await page.getAttribute('#sim-state-badge', 'data-state'))    ?? 'idle',
    currentBid: parseInt((await page.getAttribute('#current-bid', 'data-current-bid')) ?? '0'),
    lastBidMs:  parseInt((await page.getAttribute('#current-bid', 'data-last-bid-ms'))  ?? '0'),
    lotNumber:  (await page.getAttribute('#lot-title', 'data-lot-number')) ?? '',
  }
}

async function getSaleroomBid(page: Page): Promise<number> {
  return parseInt((await page.getAttribute('#sr-state', 'data-current-bid')) ?? '0')
}

async function sleep(ms: number) {
  return new Promise(r => setTimeout(r, ms))
}

// ── MAIN ─────────────────────────────────────────────────────────────────────
async function main() {
  const browser = await chromium.launch({ headless: false })
  const context = await browser.newContext()

  log('Opening Bidpath panel…')
  const bidpathPage = await context.newPage()
  await bidpathPage.goto(BIDPATH_URL)
  await bidpathPage.waitForLoadState('domcontentloaded')

  log('Opening Saleroom panel…')
  const saleroomPage = await context.newPage()
  await saleroomPage.goto(SALEROOM_URL)
  await saleroomPage.waitForLoadState('domcontentloaded')

  // Start simulation (only applies to simulated Bidpath HTML — no-op on real pages)
  const startBtn = bidpathPage.locator('#btn-start')
  if (await startBtn.count() > 0) {
    await startBtn.click()
    log('Simulation started on Bidpath')
  } else {
    log('No start button — assuming real Bidpath page')
  }

  let fwIssued      = false
  let fwIssuedAt    = 0
  let lastBidMs     = Date.now()
  let lastKnownBid  = 0
  let lastLot       = ''

  log('Coordinator running — press Ctrl+C to stop')

  // ── MAIN LOOP ──
  while (true) {
    try {
      const bp      = await getBidpathState(bidpathPage)
      const srBid   = await getSaleroomBid(saleroomPage)
      const now     = Date.now()

      // Skip if sim is idle or done
      if (bp.state === 'idle' || bp.state === 'done') {
        await sleep(1000)
        continue
      }

      // New lot — reset state
      if (bp.lotNumber && bp.lotNumber !== lastLot) {
        log(`New lot: ${bp.lotNumber}`)
        lastLot    = bp.lotNumber
        lastBidMs  = now
        fwIssued   = false
        lastKnownBid = bp.currentBid
      }

      // ── BID SYNC: Bidpath has a higher bid than Saleroom ──
      // Click Bid on Saleroom to step it up
      if (bp.currentBid > srBid && bp.currentBid > 0) {
        log(`Bidpath £${bp.currentBid} > Saleroom £${srBid} → clicking Bid on Saleroom`)
        await saleroomPage.click('#bBid')
        await sleep(300)
        fwIssued = false
      }

      // Track when Bidpath last received a new bid
      if (bp.currentBid !== lastKnownBid) {
        lastKnownBid = bp.currentBid
        lastBidMs    = bp.lastBidMs > 0 ? bp.lastBidMs : now
        fwIssued     = false
      }

      // ── SILENCE DETECTION ──
      const silence = bp.lastBidMs > 0 ? now - bp.lastBidMs : now - lastBidMs

      if (bp.state === 'bidding' && !fwIssued && silence >= SILENCE_BEFORE_FW_MS) {
        log(`${SILENCE_BEFORE_FW_MS / 1000}s silence — Fair Warning on both panels`)

        // Click Fair Warning on Bidpath
        await bidpathPage.click('#fw-btn')
        await sleep(300)
        // Click Fair Warn on Saleroom
        await saleroomPage.click('#bFW')

        fwIssued   = true
        fwIssuedAt = now
      }

      if (fwIssued && (now - fwIssuedAt) >= SILENCE_BEFORE_HAMMER_MS) {
        const hammerAmount = bp.currentBid
        log(`FW timeout — Hammering at £${hammerAmount}`)

        // Click Hammer on Bidpath
        await bidpathPage.click('#hammer-btn')
        await sleep(800)

        // Fill H field on Saleroom and Sell
        await saleroomPage.fill('#fH', String(hammerAmount))
        await sleep(300)
        await saleroomPage.click('#btn-sell')
        await sleep(600)

        // Click Next on Saleroom
        await saleroomPage.click('#btn-next')

        log(`Lot ${lastLot} complete — sold at £${hammerAmount}`)
        fwIssued     = false
        lastKnownBid = 0
        lastBidMs    = now
        await sleep(1000)
      }

    } catch (err: any) {
      // Page may be navigating — wait and retry
      log(`Error: ${err?.message ?? err} — retrying…`)
      await sleep(1000)
    }

    await sleep(300)
  }
}

main().catch(err => {
  console.error('Fatal error:', err)
  process.exit(1)
})
