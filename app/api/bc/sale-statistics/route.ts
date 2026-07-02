import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { getBCToken, bcPageWithNext } from "@/lib/bc"

export const maxDuration = 60

// Buyer's premium the house earns — 22.5% of hammer (ex-VAT). This lands within
// a rounding whisker of BC's own "Buyer's Premium" figure. Adjust here if the
// house rate changes. (Seller's/vendor commission is NOT derivable from the
// lines — it varies per vendor — so it comes from EVA_AuctionHeader later.)
const BUYERS_PREMIUM_RATE = 0.225

// Auction_Lines_Excel is item-level (one row per lot) and carries hammer,
// estimates, category, subcategory and the EVA_Collected flag. We aggregate it
// into (auction × category × subcategory) buckets so the client can roll up by
// any combination without re-fetching. We deliberately do NOT send $select: BC
// 400s the entire request on any single unknown field name, and the exact field
// set isn't fully documented — fetching all columns is robust (we only ever keep
// the aggregates, so the client payload stays small).
const ENDPOINT = "Auction_Lines_Excel"

const truthy = (v: unknown) => v === true || v === 1 || v === "true" || v === "Yes" || v === "1"

type Bucket = {
  auctionNo: string; auctionName: string; auctionDate: string
  category: string; subcategory: string
  lots: number; sold: number; hammer: number; low: number; high: number; collected: number
  withdrawn: number; sellerPremium: number
}

// The per-line vendor commission rate field — detected from the row so we don't
// hardcode a possibly-wrong name. Preferred exact names first, then a pattern.
function findCommissionField(fields: string[]): string {
  const prefer = ["EVA_VendorCommissionRate", "EVA_CommissionRate", "EVA_VendorCommission", "EVA_CommissionPct", "EVA_CommissionPercent"]
  return prefer.find(f => fields.includes(f))
    ?? fields.find(f => /commiss/i.test(f) && /(rate|pct|percent)/i.test(f))
    ?? ""
}

// Generic field detector: preferred exact names first, then a pattern.
function findField(fields: string[], prefer: string[], pattern: RegExp): string {
  return prefer.find(f => fields.includes(f)) ?? fields.find(f => pattern.test(f)) ?? ""
}

// A commission rate may be stored as a percentage (15 → 15%) or a fraction
// (0.15). Normalise to a fraction of hammer.
const asFraction = (rate: number) => (rate > 1 ? rate / 100 : rate)

// Add a value to a per-key Set (for distinct counts — vendors, winning buyers).
function addTo(m: Map<string, Set<string>>, key: string, val: string) {
  let s = m.get(key); if (!s) { s = new Set(); m.set(key, s) } s.add(val)
}

function send(controller: ReadableStreamDefaultController, obj: object) {
  controller.enqueue(new TextEncoder().encode(JSON.stringify(obj) + "\n"))
}

const num = (v: unknown) => { const n = Number(v); return Number.isFinite(n) ? n : 0 }

// GET /api/bc/sale-statistics?from=YYYY-MM-DD&to=YYYY-MM-DD
// Streams NDJSON: {type:"progress"} … then {type:"result", data:{ buckets, ... }}.
// Always pass a date range — an unbounded fetch would walk the whole history.
export async function GET(req: NextRequest) {
  const session = await auth()
  if (!session) return NextResponse.json({ error: "Unauthorised" }, { status: 401 })

  const from = req.nextUrl.searchParams.get("from")?.trim() || ""
  const to   = req.nextUrl.searchParams.get("to")?.trim()   || ""

  const stream = new ReadableStream({
    async start(controller) {
      try {
        const token = await getBCToken()
        if (!token) { send(controller, { type: "error", error: "BC_NOT_CONNECTED" }); controller.close(); return }

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

        // Walk via @odata.nextLink (no $skip ceiling — see BC reference).
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
            buyerField      = findField(sampleFields, ["EVA_BuyerNo", "EVA_BuyerCode", "EVA_BuyerNumber", "EVA_WinningBidderNo"], /buyer.*(no|code|number|id)|winning.*bidder/i)
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
          send(controller, { type: "progress", done: processed, total: processed })

          link = nextLink
          if (!nextLink) break
        }

        // Distinct vendor / winning-buyer counts per sale (can't be summed from buckets).
        const saleDistinct = [...new Set([...vendorsByAuction.keys(), ...buyersByAuction.keys()])].map(a => ({
          auctionNo:        a,
          vendors:          vendorsByAuction.get(a)?.size ?? 0,
          successfulBuyers: buyersByAuction.get(a)?.size ?? 0,
        }))

        send(controller, {
          type: "result",
          data: {
            buckets:               [...buckets.values()],
            total:                 processed,
            partial,
            buyersPremiumRate:     BUYERS_PREMIUM_RATE,
            range:                 { from, to },
            sampleFields,          // field names on the endpoint — for verifying the mapping
            commissionField,       // per-line field used for seller's premium ("" if none found)
            withdrawnField,        // per-line withdrawn flag field ("" if none found)
            vendorField,           // per-line vendor field ("" if none found)
            buyerField,            // per-line buyer field ("" if none found → successful buyers N/A)
            saleDistinct,          // [{ auctionNo, vendors, successfulBuyers }] — distinct per sale
            totalVendors:          allVendors.size,
            totalSuccessfulBuyers: allBuyers.size,
          },
        })
      } catch (e: any) {
        send(controller, { type: "error", error: e?.message ?? "Unknown error" })
      }
      controller.close()
    },
  })

  return new Response(stream, { headers: { "Content-Type": "text/plain; charset=utf-8" } })
}
