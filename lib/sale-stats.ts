// Sale results from Business Central, aggregated per (sale × category × subcategory).
//
// Lifted out of /api/bc/sale-statistics when the Dashboard needed the same
// figures. The route still streams progress — it passes an onProgress callback —
// so there is one implementation of the maths and the Sale Statistics page and
// the dashboard widgets cannot report different money for the same sale.
//
// ⚠ CACHED, and that is not an optimisation — it is what makes the dashboard
// possible. Four widgets (sale value, sell-through, recent results, vendors &
// buyers) all need this, they load at the same moment, and one call walks BC for
// up to 50 seconds. Without the shared in-flight promise below, opening the
// dashboard would fire four full walks at a rate-limited API.

import { getBCToken, bcPageWithNext } from "@/lib/bc"

// Buyer's premium the house earns — 22.5% of hammer (ex-VAT). Lands within a
// rounding whisker of BC's own figure. Adjust here if the house rate changes.
export const BUYERS_PREMIUM_RATE = 0.225

// Auction_Lines_Excel is item-level (one row per lot) and carries hammer,
// estimates, category, subcategory and the EVA_Collected flag. We deliberately
// do NOT send $select: BC 400s the whole request on any single unknown field
// name, and the exact field set isn't fully documented.
const ENDPOINT = "Auction_Lines_Excel"

const truthy = (v: unknown) => v === true || v === 1 || v === "true" || v === "Yes" || v === "1"
const num = (v: unknown) => { const n = Number(v); return Number.isFinite(n) ? n : 0 }

export type Bucket = {
  auctionNo: string; auctionName: string; auctionDate: string
  category: string; subcategory: string
  lots: number; sold: number; hammer: number; low: number; high: number; collected: number
  withdrawn: number; sellerPremium: number
}

export type SaleStats = {
  buckets: Bucket[]
  total: number
  partial: boolean
  buyersPremiumRate: number
  range: { from: string; to: string }
  sampleFields: string[]
  commissionField: string
  withdrawnField: string
  vendorField: string
  buyerField: string
  saleDistinct: { auctionNo: string; vendors: number; successfulBuyers: number }[]
  totalVendors: number
  totalSuccessfulBuyers: number
  connected: boolean
}

// The per-line vendor commission rate field — detected from the row so we don't
// hardcode a possibly-wrong name. BC's caption is "Vendor Comm Rate" —
// abbreviated "Comm", so match /comm/ not /commiss/.
function findCommissionField(fields: string[]): string {
  const prefer = ["EVA_VendorCommRate", "EVA_VendorCommissionRate", "EVA_CommRate", "EVA_CommissionRate", "EVA_VendorCommission", "EVA_CommissionPct"]
  return prefer.find(f => fields.includes(f))
    ?? fields.find(f => /comm/i.test(f) && /(rate|pct|percent)/i.test(f))
    ?? ""
}

function findField(fields: string[], prefer: string[], pattern: RegExp): string {
  return prefer.find(f => fields.includes(f)) ?? fields.find(f => pattern.test(f)) ?? ""
}

/** A rate may be a percentage (15 → 15%) or a fraction (0.15). Normalise. */
const asFraction = (rate: number) => (rate > 1 ? rate / 100 : rate)

function addTo(m: Map<string, Set<string>>, key: string, val: string) {
  let s = m.get(key); if (!s) { s = new Set(); m.set(key, s) } s.add(val)
}

const EMPTY = (from: string, to: string): SaleStats => ({
  buckets: [], total: 0, partial: false, buyersPremiumRate: BUYERS_PREMIUM_RATE,
  range: { from, to }, sampleFields: [], commissionField: "", withdrawnField: "",
  vendorField: "", buyerField: "", saleDistinct: [], totalVendors: 0,
  totalSuccessfulBuyers: 0, connected: false,
})

/**
 * Walk BC's auction lines for a date range and aggregate them.
 *
 * Always pass a range — an unbounded fetch would walk the whole history.
 * `partial` comes back true when the 50s budget ran out mid-walk; the caller
 * must say so rather than presenting a short total as the real one.
 */
export async function computeSaleStats(
  from: string,
  to: string,
  onProgress?: (processed: number) => void,
): Promise<SaleStats> {
  const token = await getBCToken()
  if (!token) return EMPTY(from, to)

  const clauses: string[] = []
  if (from) clauses.push(`EVA_AuctionDate ge ${from}`)
  if (to)   clauses.push(`EVA_AuctionDate le ${to}`)
  const params: Record<string, string | number> = {}
  if (clauses.length) params.$filter = clauses.join(" and ")

  const buckets = new Map<string, Bucket>()
  const vendorsByAuction = new Map<string, Set<string>>()
  const buyersByAuction  = new Map<string, Set<string>>()
  const allVendors = new Set<string>()
  const allBuyers  = new Set<string>()
  let sampleFields: string[] = []
  let commissionField = "", vendorField = "", withdrawnField = "", buyerField = ""
  let processed = 0
  let partial = false
  const startMs = Date.now()

  // Walk via @odata.nextLink (no $skip ceiling — see the BC reference).
  let link: string | null = null
  let first = true
  while (true) {
    if (Date.now() - startMs > 50_000) { partial = true; break }

    const { rows, nextLink } = await bcPageWithNext(
      token,
      first ? ENDPOINT : (link as string),
      first ? params : undefined,
    )
    first = false
    if (!sampleFields.length && rows.length) {
      sampleFields    = Object.keys(rows[0] as object)
      commissionField = findCommissionField(sampleFields)
      vendorField     = findField(sampleFields, ["EVA_VendorNo", "EVA_VendorCode", "EVA_VendorNumber"], /vendor.*(no|code|number|id)/i)
      withdrawnField  = findField(sampleFields, ["EVA_WithdrawLot", "EVA_Withdrawn", "EVA_WithdrawnLot"], /withdraw/i)
      buyerField      = findField(sampleFields, ["EVA_BuyerNo", "EVA_BuyerName", "EVA_BuyerCode", "EVA_BuyerNumber", "EVA_WinningBidderNo"], /buyer.*(no|code|number|id|name)|winning.*bidder/i)
    }

    for (const r of rows as Record<string, unknown>[]) {
      const auctionNo = String(r.EVA_AuctionNo ?? "").trim()
      if (!auctionNo) continue
      const category    = String(r.EVA_ArticleCategoryCode ?? "").trim() || "(uncategorised)"
      const subcategory = String(r.EVA_ArticleSubcategoryCode ?? "").trim() || "(none)"
      const key = `${auctionNo}|${category}|${subcategory}`

      let b = buckets.get(key)
      if (!b) {
        b = {
          auctionNo,
          auctionName: String(r.EVA_AuctionName ?? "").trim(),
          auctionDate: String(r.EVA_AuctionDate ?? "").slice(0, 10),
          category, subcategory,
          lots: 0, sold: 0, hammer: 0, low: 0, high: 0, collected: 0, withdrawn: 0, sellerPremium: 0,
        }
        buckets.set(key, b)
      }

      const hammer = num(r.EVA_HammerPrice)
      b.lots += 1
      if (hammer > 0) b.sold += 1          // sold = has a hammer price; unsold = lots - sold
      b.hammer += hammer
      b.low  += num(r.EVA_LowEstimate)
      b.high += num(r.EVA_HighEstimate)
      if (truthy(r.EVA_Collected)) b.collected += 1
      if (withdrawnField && truthy(r[withdrawnField])) b.withdrawn += 1
      // Seller's premium = hammer × per-line vendor commission rate.
      if (commissionField) b.sellerPremium += hammer * asFraction(num(r[commissionField]))
      // Distinct vendors (any line) and successful buyers (sold lines) per sale.
      if (vendorField) { const v = String(r[vendorField] ?? "").trim(); if (v) { addTo(vendorsByAuction, auctionNo, v); allVendors.add(v) } }
      if (hammer > 0 && buyerField) { const bn = String(r[buyerField] ?? "").trim(); if (bn) { addTo(buyersByAuction, auctionNo, bn); allBuyers.add(bn) } }
    }

    processed += rows.length
    onProgress?.(processed)

    link = nextLink
    if (!nextLink) break
  }

  // Distinct vendor / winning-buyer counts per sale (can't be summed from buckets).
  const saleDistinct = [...new Set([...vendorsByAuction.keys(), ...buyersByAuction.keys()])].map(a => ({
    auctionNo:        a,
    vendors:          vendorsByAuction.get(a)?.size ?? 0,
    successfulBuyers: buyersByAuction.get(a)?.size ?? 0,
  }))

  return {
    buckets: [...buckets.values()],
    total: processed,
    partial,
    buyersPremiumRate: BUYERS_PREMIUM_RATE,
    range: { from, to },
    sampleFields, commissionField, withdrawnField, vendorField, buyerField,
    saleDistinct,
    totalVendors: allVendors.size,
    totalSuccessfulBuyers: allBuyers.size,
    connected: true,
  }
}

// ─── Shared cache ────────────────────────────────────────────────────────────
// Keyed by range. Holds the PROMISE, not the result, so widgets that arrive
// while a walk is already running join that walk instead of starting another.

const TTL_MS = 5 * 60_000
const cache = new Map<string, { at: number; promise: Promise<SaleStats> }>()

export function getSaleStatsCached(from: string, to: string): Promise<SaleStats> {
  const key = `${from}|${to}`
  const hit = cache.get(key)
  if (hit && Date.now() - hit.at < TTL_MS) return hit.promise

  const promise = computeSaleStats(from, to).catch(e => {
    // Never cache a failure — the next widget should get a fresh attempt rather
    // than five minutes of the same error.
    cache.delete(key)
    throw e
  })
  cache.set(key, { at: Date.now(), promise })

  // Keep the map from growing without bound on a long-lived server.
  if (cache.size > 24) {
    for (const [k, v] of cache) if (Date.now() - v.at > TTL_MS) cache.delete(k)
  }
  return promise
}

// ─── Roll-ups the widgets share ──────────────────────────────────────────────

export type Roll = {
  lots: number; sold: number; hammer: number; low: number; high: number
  collected: number; withdrawn: number; sellerPremium: number
}

export const emptyRoll = (): Roll => ({
  lots: 0, sold: 0, hammer: 0, low: 0, high: 0, collected: 0, withdrawn: 0, sellerPremium: 0,
})

export function rollUp(buckets: Bucket[]): Roll {
  const r = emptyRoll()
  for (const b of buckets) {
    r.lots += b.lots; r.sold += b.sold; r.hammer += b.hammer
    r.low += b.low; r.high += b.high; r.collected += b.collected
    r.withdrawn += b.withdrawn; r.sellerPremium += b.sellerPremium
  }
  return r
}

/** Per-sale roll-up, newest sale date first. */
export function rollUpBySale(buckets: Bucket[]): { code: string; name: string; date: string; roll: Roll }[] {
  const m = new Map<string, { code: string; name: string; date: string; roll: Roll }>()
  for (const b of buckets) {
    let e = m.get(b.auctionNo)
    if (!e) { e = { code: b.auctionNo, name: b.auctionName, date: b.auctionDate, roll: emptyRoll() }; m.set(b.auctionNo, e) }
    e.roll.lots += b.lots; e.roll.sold += b.sold; e.roll.hammer += b.hammer
    e.roll.low += b.low; e.roll.high += b.high; e.roll.collected += b.collected
    e.roll.withdrawn += b.withdrawn; e.roll.sellerPremium += b.sellerPremium
  }
  return [...m.values()].sort((a, b) => (b.date || "").localeCompare(a.date || ""))
}

/** Offered = lots that could sell, i.e. excluding withdrawn. */
export const offered = (r: Roll) => Math.max(0, r.lots - r.withdrawn)
export const sellThrough = (r: Roll) => (offered(r) > 0 ? r.sold / offered(r) : 0)
export const vsHigh = (r: Roll) => (r.high > 0 ? r.hammer / r.high - 1 : 0)

// ─── Formatting shared by the widgets ────────────────────────────────────────

export const gbp0 = (n: number) =>
  new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP", maximumFractionDigits: 0 }).format(n || 0)

export const pct = (f: number) => `${(f * 100).toFixed(1)}%`
export const pctSigned = (f: number) => `${f >= 0 ? "+" : ""}${(f * 100).toFixed(1)}%`

/** Default window for the money widgets: the last 12 months, as yyyy-MM-dd. */
export function defaultRange(): { from: string; to: string } {
  const now = new Date()
  const to = now.toISOString().slice(0, 10)
  const past = new Date(now)
  past.setMonth(past.getMonth() - 12)
  return { from: past.toISOString().slice(0, 10), to }
}
